'use strict';

/* ======================= Hằng số & tiện ích ======================= */
const LEVELS = {"Dễ": [9, 9, 10], "Trung bình": [16, 16, 40], "Khó": [16, 30, 99]};
const PALETTE = {1: "#5AA9FF", 2: "#66E0AB", 3: "#FF8B91", 4: "#B5A4FF", 5: "#FFB978", 6: "#5CE1E6", 7: "#FFDA80", 8: "#E6ECF8"};
const TILE_DEFAULT = 35, TILE_MIN = 28, TILE_MAX = 52;
const MAX_RECORDS = 1000;
const MAX_HINTS = 3;

const $ = (id) => document.getElementById(id);
// Cache các phần tử được dùng thường xuyên (script được nạp sau khi DOM sẵn sàng)
const el = {
    board: $('boardCanvas'),
    status: $('statusLabel'),
    mines: $('minesLabel'),
    time: $('timeLabel'),
    progress: $('progressLabel'),
    pauseBtn: $('pauseBtn'),
    hintCount: $('hintCount'),
    flagModeBtn: $('flagModeBtn'),
    helpLabel: $('helpLabel'),
};

const isTouchUI = () => window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
const vibrate = (pattern) => {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* không hỗ trợ */ }
};

const pad2 = (n) => String(n).padStart(2, '0');
const formatTime = (s) => `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const store = {
    get(key, fallback) {
        try {
            const v = JSON.parse(localStorage.getItem(key));
            return v ?? fallback;
        } catch (e) { return fallback; }
    },
    set(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* đầy bộ nhớ / chế độ riêng tư */ }
    },
};

/* ============================ Cài đặt ============================= */
const settings = {light: false, sound: false, animations: true, effects_3d: true, celebrations: true, tile_size: TILE_DEFAULT};

function loadSettings() {
    const saved = store.get("settings_json", null);
    if (saved && typeof saved === 'object') Object.assign(settings, saved);
    settings.tile_size = clamp(Number(settings.tile_size) || TILE_DEFAULT, TILE_MIN, TILE_MAX);
}
function saveSettings() {
    store.set("settings_json", settings);
}
// index.html gọi persistSettings() từ các ô tick "Âm thanh" / "Hiệu ứng"
function persistSettings() {
    saveSettings();
}

/* ============================ Kỷ lục ============================== */
class Records {
    constructor() {
        const saved = store.get("stats_json", []);
        this.items = Array.isArray(saved) ? saved : [];
    }
    add(level, won, seconds, assisted = false, daily = false) {
        this.items.push({
            time: new Date().toISOString().slice(0, 19),
            level, won: Boolean(won), seconds: seconds | 0,
            assisted: Boolean(assisted), daily: Boolean(daily),
        });
        if (this.items.length > MAX_RECORDS) this.items = this.items.slice(-MAX_RECORDS);
        store.set("stats_json", this.items);
    }
    leaderboard(level = null, limit = 20) {
        let entries = this.items.filter(x => x.won && !x.assisted);
        if (level && level !== "Tất cả") entries = entries.filter(x => x.level === level);
        entries.sort((a, b) => a.seconds - b.seconds || a.time.localeCompare(b.time));
        return entries.slice(0, limit);
    }
    summary() {
        const total = this.items.length;
        let wins = 0;
        const best = {};
        for (const x of this.items) {
            if (!x.won) continue;
            wins++;
            if (!x.assisted) {
                const k = x.level || "?";
                best[k] = Math.min(best[k] ?? Infinity, x.seconds);
            }
        }
        return [total, wins, best];
    }
}
const records = new Records();

/* ====================== Bộ sinh số ngẫu nhiên ===================== */
// mulberry32: nhanh, phân phối tốt, tái lập được theo seed
class SimpleRNG {
    constructor(seed) {
        this.state = (seed ?? Math.floor(Math.random() * 4294967296)) | 0;
    }
    random() {
        this.state = (this.state + 0x6D2B79F5) | 0;
        let t = this.state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    int(n) {
        return Math.floor(this.random() * n);
    }
}

/* ============================ Logic game ========================== */
// Ô được đánh chỉ số một chiều: i = r * cols + c (nhanh hơn chuỗi "r,c" và Set)
class Game {
    constructor(rows = 9, cols = 9, mines = 10, seed = null) {
        if (!(2 <= rows && rows <= 30 && 2 <= cols && cols <= 40)) {
            throw new Error("Kích thước phải trong phạm vi 2–30 hàng và 2–40 cột");
        }
        if (!(1 <= mines && mines <= rows * cols - Math.min(rows, 3) * Math.min(cols, 3))) {
            throw new Error("Quá nhiều mìn để bảo đảm vùng mở đầu an toàn");
        }
        this.rows = rows;
        this.cols = cols;
        this.mines = mines;
        this.size = rows * cols;
        this.rng = new SimpleRNG(seed);

        this.bombs = new Uint8Array(this.size);
        this.counts = new Uint8Array(this.size);   // số mìn xung quanh, tính một lần khi đặt mìn
        this.opened = new Uint8Array(this.size);
        this.flags = new Uint8Array(this.size);
        this.openedCount = 0;
        this.flagCount = 0;

        this.started = false;
        this.finished = false;
        this.won = false;
        this.hit = -1;
        this.assisted = false;
        this.hints_used = 0;

        this.neighbors = this._buildNeighbors();
    }

    _buildNeighbors() {
        const {rows, cols} = this;
        const out = new Array(rows * cols);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const list = [];
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        if (!dr && !dc) continue;
                        const nr = r + dr, nc = c + dc;
                        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) list.push(nr * cols + nc);
                    }
                }
                out[r * cols + c] = list;
            }
        }
        return out;
    }

    place(initial) {
        const safe = new Uint8Array(this.size);
        safe[initial] = 1;
        for (const n of this.neighbors[initial]) safe[n] = 1;

        const pool = [];
        for (let i = 0; i < this.size; i++) if (!safe[i]) pool.push(i);

        // Partial Fisher–Yates: O(mines) thay vì splice O(n) cho mỗi mìn
        for (let k = 0; k < this.mines; k++) {
            const j = k + this.rng.int(pool.length - k);
            [pool[k], pool[j]] = [pool[j], pool[k]];
            const b = pool[k];
            this.bombs[b] = 1;
            for (const n of this.neighbors[b]) this.counts[n]++;
        }
        this.started = true;
    }

    flag(i) {
        if (this.finished || this.opened[i]) return false;
        if (this.flags[i]) {
            this.flags[i] = 0;
            this.flagCount--;
            return true;
        }
        if (this.flagCount >= this.mines) return false;
        this.flags[i] = 1;
        this.flagCount++;
        return true;
    }

    // Trả về mảng các ô vừa được mở
    open(i) {
        if (this.finished || this.flags[i] || this.opened[i]) return [];
        if (!this.started) this.place(i);
        if (this.bombs[i]) {
            this.hit = i;
            this.finished = true;
            return [];
        }
        const newly = [];
        const stack = [i];
        while (stack.length) {
            const cur = stack.pop();
            if (this.opened[cur] || this.flags[cur]) continue;
            this.opened[cur] = 1;
            this.openedCount++;
            newly.push(cur);
            if (this.counts[cur] === 0) {
                // Ô số 0 không có mìn lân cận nên không cần kiểm tra bombs
                for (const n of this.neighbors[cur]) {
                    if (!this.opened[n] && !this.flags[n]) stack.push(n);
                }
            }
        }
        if (this.openedCount === this.size - this.mines) {
            this.finished = true;
            this.won = true;
        }
        return newly;
    }

    chord(i) {
        if (!this.opened[i] || this.finished) return [];
        const around = this.neighbors[i];
        let flagged = 0;
        for (const n of around) flagged += this.flags[n];
        if (this.counts[i] !== flagged) return [];
        let result = [];
        for (const n of around) {
            if (this.finished) break;
            const res = this.open(n);
            if (res.length) result = result.concat(res);
        }
        return result;
    }

    hint() {
        if (this.finished || !this.started || this.hints_used >= MAX_HINTS) return -1;
        const candidates = [];
        for (let i = 0; i < this.size; i++) {
            if (!this.bombs[i] && !this.opened[i] && !this.flags[i]) candidates.push(i);
        }
        if (!candidates.length) return -1;
        this.assisted = true;
        this.hints_used++;
        return candidates[this.rng.int(candidates.length)];
    }
}

/* ========================= Trạng thái giao diện =================== */
let game = null;
let tiles = [];            // tham chiếu DOM của từng ô, truy cập theo chỉ số
let seconds = 0;
let elapsedBase = 0;       // số giây đã tích lũy trước lần chạy đồng hồ hiện tại
let startedAt = 0;
let timerInterval = null;
let paused = false;
let daily = false;
let levelName = 'Dễ';
let wasRecorded = false;

/* ============================ Đồng hồ ============================= */
// Tính theo mốc thời gian thực nên không bị trôi khi tab bị trình duyệt làm chậm
function syncSeconds() {
    if (startedAt) seconds = elapsedBase + Math.floor((Date.now() - startedAt) / 1000);
}
function tick() {
    const prev = seconds;
    syncSeconds();
    if (seconds !== prev) updateTime();
}
function startTimer() {
    stopTimer();
    startedAt = Date.now();
    timerInterval = setInterval(tick, 250);
}
function stopTimer() {
    if (timerInterval === null) return;
    syncSeconds();
    clearInterval(timerInterval);
    timerInterval = null;
    elapsedBase = seconds;
    startedAt = 0;
}

/* ============================ Giao diện =========================== */
function applySettingsToUI() {
    document.body.classList.toggle('light-theme', settings.light);
    $('themeBtn').innerText = settings.light ? '☾ GIAO DIỆN TỐI' : '☼ GIAO DIỆN SÁNG';
    $('soundBox').checked = settings.sound;
    $('animationBox').checked = settings.animations;
}

function toggleTheme() {
    settings.light = !settings.light;
    saveSettings();
    applySettingsToUI();
}

function onLevelChanged() {
    const val = $('levelSelect').value;
    const custom = val === 'Tùy chỉnh';
    $('customInputs').style.display = custom ? 'flex' : 'none';
    if (!custom && LEVELS[val]) {
        const [r, c, m] = LEVELS[val];
        $('rowsBox').value = r;
        $('colsBox').value = c;
        $('minesBox').value = m;
    }
}

function setStatus(text) {
    el.status.innerText = text;
}

function startNewGame(isDaily = false) {
    isDaily = isDaily === true;
    let rows, cols, mines, seed = null, name;

    if (isDaily) {
        [rows, cols, mines] = LEVELS['Trung bình'];
        const d = new Date();
        // Dùng ngày UTC để mọi người cùng nhận một bảng trong ngày
        seed = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
        name = 'Hằng ngày';
    } else {
        rows = parseInt($('rowsBox').value, 10);
        cols = parseInt($('colsBox').value, 10);
        mines = parseInt($('minesBox').value, 10);
        const sel = $('levelSelect').value;
        name = sel === 'Tùy chỉnh' ? `Tùy chỉnh ${rows}×${cols} (${mines} mìn)` : sel;
    }

    // Tạo ván mới trước: nếu tham số sai thì giữ nguyên ván đang chơi
    let next;
    try {
        next = new Game(rows, cols, mines, seed);
    } catch (e) {
        alert(e.message);
        return;
    }

    stopTimer();
    game = next;
    daily = isDaily;
    levelName = name;
    seconds = 0;
    elapsedBase = 0;
    paused = false;
    wasRecorded = false;
    el.pauseBtn.innerText = 'Ⅱ TẠM DỪNG';
    el.hintCount.innerText = String(MAX_HINTS);

    buildBoardDOM(rows, cols);
    setStatus(daily ? 'Thử thách hằng ngày • bảng giống nhau trong ngày!' : 'Sẵn sàng! Lượt đầu tiên luôn an toàn trong vùng 3×3.');
    updateTime();
    updateMetrics();
    renderAll();
}

function buildBoardDOM(rows, cols) {
    const size = settings.tile_size + 'px';
    el.board.textContent = '';
    el.board.style.gridTemplateColumns = `repeat(${cols}, ${size})`;
    el.board.style.gridTemplateRows = `repeat(${rows}, ${size})`;

    const frag = document.createDocumentFragment();
    tiles = new Array(rows * cols);
    for (let i = 0; i < tiles.length; i++) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'tile';
        tile.style.width = size;
        tile.style.height = size;
        tile.dataset.i = i;
        tiles[i] = tile;
        frag.appendChild(tile);
    }
    el.board.appendChild(frag);
}

/* ===================== Sự kiện chuột & cảm ứng ==================== */
// Event delegation: 1 bộ lắng nghe cho cả bảng thay vì 3 bộ cho mỗi ô
const LONG_PRESS_MS = 380;   // giữ lâu hơn mức này = hành động "giữ"
const MOVE_TOLERANCE = 10;   // px; vuốt xa hơn = người chơi đang cuộn bảng, huỷ thao tác
let flagMode = false;        // chế độ cờ: chạm = cắm/gỡ cờ
let press = null;            // thao tác chạm đang diễn ra
let lastTouchAt = 0;         // để bỏ qua click/contextmenu/dblclick do trình duyệt tự sinh sau khi chạm

function tileIndexFromEvent(e) {
    const tile = e.target.closest ? e.target.closest('.tile') : null;
    return tile ? Number(tile.dataset.i) : -1;
}
const recentTouch = () => Date.now() - lastTouchAt < 700;

// --- Chuột (máy tính) ---
el.board.addEventListener('click', (e) => {
    if (e.pointerType === 'touch' || recentTouch()) return;
    const i = tileIndexFromEvent(e);
    if (i >= 0) handleOpen(i);
});
el.board.addEventListener('contextmenu', (e) => {
    const i = tileIndexFromEvent(e);
    if (i < 0) return;
    e.preventDefault();                      // luôn chặn menu hệ thống (kể cả khi giữ ngón tay)
    if (recentTouch()) return;
    handleFlag(i);
});
el.board.addEventListener('dblclick', (e) => {
    const i = tileIndexFromEvent(e);
    if (i < 0) return;
    e.preventDefault();
    if (recentTouch()) return;
    handleChord(i);
});

// --- Cảm ứng (điện thoại / máy tính bảng) ---
// Chạm: mở ô (hoặc cắm cờ nếu đang ở chế độ cờ); chạm vào ô số đã mở: mở các ô xung quanh
// Giữ: cắm/gỡ cờ (ngược lại với chế độ hiện tại); giữ vào ô số đã mở: mở các ô xung quanh
function handleTap(i) {
    if (isBlocked()) return;
    if (game.opened[i]) handleChord(i);
    else if (flagMode) handleFlag(i);
    else handleOpen(i);
}

function handleLongPress(i) {
    if (isBlocked()) return;
    if (game.opened[i]) { handleChord(i); return; }
    vibrate(18);
    if (flagMode) handleOpen(i);
    else handleFlag(i);
}

function cancelPress() {
    if (!press) return;
    clearTimeout(press.timer);
    tiles[press.i]?.classList.remove('pressing');
    press = null;
}

el.board.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    lastTouchAt = Date.now();
    if (!e.isPrimary) { cancelPress(); return; }      // thêm ngón thứ hai (pinch) → huỷ
    const i = tileIndexFromEvent(e);
    if (i < 0) return;
    cancelPress();
    const p = {i, x: e.clientX, y: e.clientY, id: e.pointerId, long: false, timer: 0};
    p.timer = setTimeout(() => {
        p.long = true;
        tiles[p.i]?.classList.remove('pressing');
        handleLongPress(p.i);
    }, LONG_PRESS_MS);
    press = p;
    tiles[i].classList.add('pressing');
});

el.board.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_TOLERANCE) cancelPress();
});

el.board.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch') return;
    lastTouchAt = Date.now();
    if (!press || e.pointerId !== press.id) return;
    const {i, long} = press;
    cancelPress();
    if (!long) handleTap(i);
});

// Trình duyệt tiếp quản ngón tay (đang cuộn bảng) hoặc bị gián đoạn
el.board.addEventListener('pointercancel', cancelPress);

function updateFlagModeUI() {
    el.flagModeBtn.innerText = flagMode ? '⚑ CHẾ ĐỘ CỜ: BẬT' : '⚑ CHẾ ĐỘ CỜ: TẮT';
    el.flagModeBtn.setAttribute('accent', String(flagMode));
}

function toggleFlagMode() {
    flagMode = !flagMode;
    updateFlagModeUI();
    setStatus(flagMode ? 'Chế độ cờ BẬT • chạm để cắm/gỡ cờ, giữ để mở ô.'
                       : 'Chế độ cờ TẮT • chạm để mở ô, giữ để cắm cờ.');
}

// Tự tạm dừng khi người chơi chuyển sang ứng dụng/tab khác (đồng hồ chạy theo thời gian thực)
document.addEventListener('visibilitychange', () => {
    if (document.hidden && game && game.started && !game.finished && !paused) togglePause();
});

function isBlocked() {
    return !game || paused || game.finished;
}

/* ============================ Thao tác ============================ */
function handleOpen(i) {
    if (isBlocked()) return;
    if (game.flags[i]) {
        setStatus(`Ô này đang có cờ • ${isTouchUI() ? 'giữ ô' : 'chuột phải'} để gỡ cờ trước khi mở.`);
        return;
    }
    const wasStarted = game.started;
    const newly = game.open(i);
    if (!wasStarted && game.started) startTimer();
    afterMove(newly, true);
}

function handleFlag(i) {
    if (isBlocked()) return;
    if (game.flag(i)) {
        afterMove([i], false);
    } else if (!game.flags[i] && !game.opened[i] && game.flagCount >= game.mines) {
        setStatus('Đã dùng hết cờ • gỡ bớt cờ sai để cắm lại.');
    }
}

function handleChord(i) {
    if (isBlocked()) return;
    const newly = game.chord(i);
    if (newly.length > 0 || game.finished) afterMove(newly, true);
}

function afterMove(changed, animate) {
    updateMetrics();
    if (game.finished) {
        renderAll();           // lộ mìn / cờ khi kết thúc
    } else {
        renderCells(changed);
    }
    if (animate) playFade(changed);

    if (!game.finished) return;

    stopTimer();
    recordOutcome();
    cancelPress();
    if (settings.sound) vibrate(game.won ? [40, 60, 40, 60, 140] : [120, 60, 220]);
    if (game.won) {
        setStatus('🏆 CHIẾN THẮNG! Chúc mừng bạn!');
        setTimeout(() => {
            showGameModal(
                `🏆 HOÀN THÀNH ${levelName.toUpperCase()}!`,
                `Thời gian hoàn thành: ${formatTime(seconds)}\nThành tích đã được lưu vào bảng xếp hạng.`
            );
        }, 300);
    } else {
        setStatus('💥 GAME OVER • Hãy thử lại!');
        setTimeout(() => {
            showGameModal('💥 GAME OVER', 'Bạn đã chạm mìn! Nhấn CHƠI MỚI để thử lại.');
        }, 160);
    }
}

/* ============================== Hiển thị ========================== */
function updateTime() {
    el.time.innerText = formatTime(seconds);
}

function updateMetrics() {
    el.mines.innerText = String(game.mines - game.flagCount).padStart(3, '0');
    const goal = game.size - game.mines;
    el.progress.innerText = `${Math.floor(game.openedCount * 100 / goal)}%`;
}

// Chỉ ghi DOM khi trạng thái hiển thị của ô thực sự thay đổi
function renderTile(i) {
    const g = game, tile = tiles[i];
    let label = '', fg = 'var(--text)', bg = 'var(--panel)', border = 'var(--panel)';

    if (paused) {
        label = '•'; fg = 'var(--muted)'; bg = 'var(--surface)';
    } else if (g.hit === i) {
        label = '✹'; fg = '#FFFFFF'; bg = '#C7425F'; border = '#FF859A';
    } else if (g.finished && !g.won && g.bombs[i]) {
        label = '✹'; fg = '#FF859A'; bg = 'var(--surface)';
    } else if (g.flags[i] || (g.won && g.bombs[i])) {
        label = '⚑'; fg = '#FF708E'; border = 'var(--accent)';
    } else if (g.opened[i]) {
        const n = g.counts[i];
        label = n > 0 ? String(n) : '';
        fg = PALETTE[n] || 'var(--text)';
        bg = 'var(--surface)'; border = 'var(--surface)';
    }

    const key = `${label}|${fg}|${bg}|${border}`;
    if (tile._key === key) return;
    tile._key = key;
    tile.textContent = label;
    tile.style.color = fg;
    tile.style.backgroundColor = bg;
    tile.style.borderColor = border;
}

function renderCells(list) {
    if (!game) return;
    for (const i of list) renderTile(i);
}

function renderAll() {
    if (!game) return;
    for (let i = 0; i < tiles.length; i++) renderTile(i);
}

function playFade(list) {
    if (!settings.animations) return;
    for (const i of list) {
        const t = tiles[i];
        t.classList.remove('fade-in');
        void t.offsetWidth; // buộc reflow để chạy lại animation
        t.classList.add('fade-in');
    }
}

/* ============================ Điều khiển ========================== */
function togglePause() {
    if (!game || game.finished || !game.started) return;
    paused = !paused;
    if (paused) {
        stopTimer();
        el.pauseBtn.innerText = '▶ TIẾP TỤC';
        setStatus('ĐÃ TẠM DỪNG • Bảng đã được che.');
    } else {
        startTimer();
        el.pauseBtn.innerText = 'Ⅱ TẠM DỪNG';
        setStatus('Đang chơi!');
    }
    renderAll();
}

function useHint() {
    if (isBlocked() || !game.started) return;
    const i = game.hint();
    if (i < 0) {
        if (game.hints_used >= MAX_HINTS) setStatus('Bạn đã dùng hết lượt gợi ý.');
        return;
    }
    el.hintCount.innerText = String(MAX_HINTS - game.hints_used);
    setStatus(`Gợi ý ${game.hints_used}/${MAX_HINTS} • Ván có gợi ý không tính kỷ lục.`);
    afterMove(game.open(i), true);
}

function recordOutcome() {
    if (wasRecorded) return;
    wasRecorded = true;
    records.add(levelName, game.won, seconds, game.assisted, daily);
}

/* ============================ Hộp thoại =========================== */
function showSettings() {
    $('setLight').checked = settings.light;
    $('setSound').checked = settings.sound;
    $('setAnimations').checked = settings.animations;
    $('setEffects3d').checked = settings.effects_3d;
    $('setCelebrations').checked = settings.celebrations;
    $('setSizeSlider').value = settings.tile_size;
    $('setSizeLabel').innerText = settings.tile_size + ' px';
    $('settingsModal').style.display = 'flex';
}

function closeSettings(save) {
    if (save) {
        settings.light = $('setLight').checked;
        settings.sound = $('setSound').checked;
        settings.animations = $('setAnimations').checked;
        settings.effects_3d = $('setEffects3d').checked;
        settings.celebrations = $('setCelebrations').checked;
        settings.tile_size = clamp(parseInt($('setSizeSlider').value, 10) || TILE_DEFAULT, TILE_MIN, TILE_MAX);
        saveSettings();
        applySettingsToUI();
        if (game) {
            buildBoardDOM(game.rows, game.cols);
            renderAll();
        }
    }
    $('settingsModal').style.display = 'none';
}

function showLeaderboard() {
    refreshLeaderboard();
    $('leaderboardModal').style.display = 'flex';
}

function refreshLeaderboard() {
    const entries = records.leaderboard($('lbFilter').value, 50);
    const [total, wins] = records.summary();
    const rate = total ? (wins / total * 100).toFixed(1) : 0;
    $('lbOverview').innerText = `Tổng trận: ${total}    •    Thắng: ${wins}    •    Tỷ lệ: ${rate}%`;

    const frag = document.createDocumentFragment();
    entries.forEach((e, idx) => {
        const tr = document.createElement('tr');
        // textContent: không chèn HTML thô từ dữ liệu localStorage
        for (const text of [idx + 1, e.level, formatTime(e.seconds), e.time]) {
            const td = document.createElement('td');
            td.textContent = text;
            tr.appendChild(td);
        }
        frag.appendChild(tr);
    });
    const tbody = $('lbTableBody');
    tbody.textContent = '';
    tbody.appendChild(frag);
}

function showGameModal(title, text) {
    $('modalTitle').innerText = title;
    $('modalBody').innerText = text;
    $('gameMessageModal').style.display = 'flex';
}

/* ============================== Khởi động ========================= */
loadSettings();
applySettingsToUI();
updateFlagModeUI();
if (el.helpLabel && isTouchUI()) el.helpLabel.innerText = 'Chạm: mở • Giữ: cờ • Chạm số: mở quanh';
onLevelChanged();
startNewGame(false);
