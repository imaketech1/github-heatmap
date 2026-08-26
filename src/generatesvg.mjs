import { writeFile } from 'node:fs/promises';

const USERNAME = process.env.GITHUB_USERNAME || process.env.GITHUB_REPOSITORY_OWNER || 'imaketech1';
const OUTPUT_PATH = process.env.OUTPUT_PATH || 'heatmap.svg';

const CELL = 12;
const HEATMAP_COLS = 53;
const BUFFER_COLS = 8;
const COLS = HEATMAP_COLS + BUFFER_COLS;
const ROWS = 7;
const WALL_COMMIT_THRESHOLD = 3;
const OFFSET_X = 20;
const OFFSET_Y = 30;
const WIDTH = OFFSET_X * 2 + COLS * CELL;
const HEIGHT = OFFSET_Y * 2 + ROWS * CELL;
const ATTACKER_SPEED = 0.3;
const MAX_ATTACKERS = 8;

const ATTACKER_GIF = 'nm263.gif';
const FUTURE_GIF = 'e109.gif';

async function fetchContributions(username) {
    const apis = [
        async () => {
            console.log(`📡 Trying GitHub Contributions API for ${username}...`);
            const res = await fetch(`https://github-contributions-api.jogruber.de/v4/${encodeURIComponent(username)}?y=last`);
            if (!res.ok) throw new Error(`API error ${res.status}`);
            const data = await res.json();
            if (!data.contributions || data.contributions.length === 0) throw new Error('No contributions data');
            console.log(`✅ Got ${data.contributions.length} days of data from GitHub API`);
            return data.contributions;
        },
        async () => {
            console.log(`📡 Trying GitHub public activity for ${username}...`);
            const res = await fetch(`https://api.github.com/users/${username}/events/public?per_page=100`);
            if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
            const events = await res.json();
            const commitCounts = {};
            for (const event of events) {
                if (event.type === 'PushEvent' && event.payload && event.payload.commits) {
                    const date = new Date(event.created_at);
                    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                    commitCounts[key] = (commitCounts[key] || 0) + event.payload.commits.length;
                }
            }
            const contributions = Object.entries(commitCounts).map(([date, count]) => ({ date, count }));
            if (contributions.length === 0) throw new Error('No commit events found');
            console.log(`✅ Got ${contributions.length} days of data from GitHub events`);
            return contributions;
        },
        async () => {
            console.log(`🎮 Using seeded demo data for ${username}...`);
            return generateSeededDemoData(username);
        }
    ];

    for (const api of apis) {
        try {
            const result = await api();
            if (result && result.length > 0) {
                const totalCommits = result.reduce((sum, c) => sum + c.count, 0);
                if (totalCommits > 0) {
                    console.log(`Total commits: ${totalCommits}`);
                    return result;
                }
                console.log(`No commits found in data (${result.length} days, 0 commits)`);
                continue;
            }
        } catch (err) {
            console.log(`Failed: ${err.message}`);
            continue;
        }
    }

    console.log(`All APIs failed, using demo data for ${username}`);
    return generateDemoData();
}

function generateSeededDemoData(username) {
    const contributions = [];
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - 364);
    const d = new Date(start);

    let seed = 0;
    for (let i = 0; i < username.length; i++) {
        seed = ((seed << 5) - seed) + username.charCodeAt(i);
        seed = seed & seed;
    }

    function seededRandom() {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    }

    while (d <= end) {
        const day = d.getDay();
        const isWeekend = day === 0 || day === 6;
        let count = 0;
        if (!isWeekend) {
            count = Math.floor(seededRandom() * 5);
            if (seededRandom() < 0.1) count += Math.floor(seededRandom() * 8);
        } else if (seededRandom() < 0.2) {
            count = Math.floor(seededRandom() * 2);
        }
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        contributions.push({ date: `${y}-${m}-${dd}`, count });
        d.setDate(d.getDate() + 1);
    }
    return contributions;
}

function generateDemoData() {
    const contributions = [];
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - 364);
    const d = new Date(start);
    while (d <= end) {
        const day = d.getDay();
        const isWeekend = day === 0 || day === 6;
        let count = 0;
        if (!isWeekend) {
            count = Math.floor(Math.random() * 5);
            if (Math.random() < 0.1) count += Math.floor(Math.random() * 8);
        } else if (Math.random() < 0.2) {
            count = Math.floor(Math.random() * 2);
        }
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        contributions.push({ date: `${y}-${m}-${dd}`, count });
        d.setDate(d.getDate() + 1);
    }
    return contributions;
}

function buildGrid(contributions) {
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - 364);
    while (start.getDay() !== 0) start.setDate(start.getDate() - 1);

    const counts = {};
    for (const { date, count } of contributions) {
        const [y, m, dd] = date.split('-').map(Number);
        counts[`${y}-${m - 1}-${dd}`] = count;
    }

    const grid = [];
    for (let r = 0; r < ROWS; r++) {
        grid[r] = [];
        for (let c = 0; c < COLS; c++) {
            grid[r][c] = {
                row: r,
                col: c,
                x: OFFSET_X + c * CELL,
                y: OFFSET_Y + r * CELL,
                hasCommit: false,
                isWall: false,
                commitCount: 0,
                wallHealth: 0,
                maxWallHealth: 0,
                isFuture: false,
                date: null,
                isBlocked: false,
                beingBrokenBy: null
            };
        }
    }

    const cur = new Date(start);
    let dayIndex = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    while (cur <= end) {
        const key = `${cur.getFullYear()}-${cur.getMonth()}-${cur.getDate()}`;
        const count = counts[key] || 0;
        const col = Math.floor(dayIndex / ROWS);
        const row = dayIndex % ROWS;

        if (col < HEATMAP_COLS && row < ROWS) {
            const cell = grid[row][col];
            cell.hasCommit = count > 0;
            cell.commitCount = count;
            cell.date = new Date(cur);

            if (cur > today) {
                cell.isFuture = true;
            }

            if (count >= WALL_COMMIT_THRESHOLD) {
                cell.isWall = true;
                cell.wallHealth = Math.min(1 + Math.floor(count / 3), 3);
                cell.maxWallHealth = cell.wallHealth;
                cell.isBlocked = true;
            }
        }
        cur.setDate(cur.getDate() + 1);
        dayIndex++;
    }

    for (let r = 0; r < ROWS; r++) {
        for (let c = HEATMAP_COLS; c < COLS; c++) {
            grid[r][c].isFuture = true;
        }
    }

    return grid;
}

function findPath(grid, startCol, startRow, endCol, endRow, attackerId) {
    if (startCol < 0 || startCol >= COLS || startRow < 0 || startRow >= ROWS) return [];
    if (endCol < 0 || endCol >= COLS || endRow < 0 || endRow >= ROWS) return [];

    const startCell = grid[startRow]?.[startCol];
    const endCell = grid[endRow]?.[endCol];

    if (startCell && startCell.isWall && startCell.wallHealth > 0) {
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const nr = startRow + dr;
                const nc = startCol + dc;
                if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
                    const cell = grid[nr]?.[nc];
                    if (cell && !cell.isWall) {
                        return findPath(grid, nc, nr, endCol, endRow, attackerId);
                    }
                }
            }
        }
        return [];
    }

    if (endCell && endCell.isWall && endCell.wallHealth > 0) {
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const nr = endRow + dr;
                const nc = endCol + dc;
                if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
                    const cell = grid[nr]?.[nc];
                    if (cell && !cell.isWall) {
                        return findPath(grid, startCol, startRow, nc, nr, attackerId);
                    }
                }
            }
        }
        return [];
    }

    const openSet = [{
        col: startCol,
        row: startRow,
        g: 0,
        h: manhattan(startCol, startRow, endCol, endRow),
        parent: null
    }];
    const closedSet = new Set();

    while (openSet.length > 0) {
        openSet.sort((a, b) => (a.g + a.h) - (b.g + b.h));
        const current = openSet.shift();

        if (current.col === endCol && current.row === endRow) {
            const path = [];
            let node = current;
            while (node.parent) {
                path.push({ col: node.col, row: node.row, isWall: false });
                node = node.parent;
            }
            path.reverse();
            return path;
        }

        const key = `${current.col},${current.row}`;
        if (closedSet.has(key)) continue;
        closedSet.add(key);

        const neighbors = [
            { dc: 1, dr: 0 }, { dc: -1, dr: 0 },
            { dc: 0, dr: 1 }, { dc: 0, dr: -1 }
        ];

        for (const neighbor of neighbors) {
            const nc = current.col + neighbor.dc;
            const nr = current.row + neighbor.dr;

            if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;

            const cell = grid[nr]?.[nc];
            if (!cell) continue;

            if (cell.isWall && cell.wallHealth > 0) {
                if (cell.beingBrokenBy !== null && cell.beingBrokenBy !== attackerId) {
                    continue;
                }
                if (cell.beingBrokenBy === null) {
                    const isAdjacent = Math.abs(nc - current.col) + Math.abs(nr - current.row) === 1;
                    if (isAdjacent) {
                        const gScore = current.g + 1;
                        const hScore = manhattan(nc, nr, endCol, endRow);
                        const nodeKey = `${nc},${nr}`;
                        if (!closedSet.has(nodeKey)) {
                            openSet.push({
                                col: nc,
                                row: nr,
                                g: gScore,
                                h: hScore,
                                parent: current,
                                isWall: true,
                                wallCell: cell
                            });
                        }
                    }
                }
                continue;
            }

            const gScore = current.g + 1;
            const hScore = manhattan(nc, nr, endCol, endRow);
            const nodeKey = `${nc},${nr}`;

            if (!closedSet.has(nodeKey)) {
                openSet.push({
                    col: nc,
                    row: nr,
                    g: gScore,
                    h: hScore,
                    parent: current,
                    isWall: false
                });
            }
        }
    }

    return [];
}

function manhattan(c1, r1, c2, r2) {
    return Math.abs(c1 - c2) + Math.abs(r1 - r2);
}

function simulateGame(grid) {
    const attackers = [];
    let wallCount = grid.flat().filter(c => c.isWall).length;
    let score = 0;
    let gameOver = false;
    let attackerCount = 0;
    const pathHistory = [];

    function spawnAttacker(col, row) {
        const attacker = {
            id: ++attackerCount,
            col,
            row,
            x: OFFSET_X + col * CELL + CELL / 2,
            y: OFFSET_Y + row * CELL + CELL / 2,
            size: CELL * 4,
            playerNumber: attackerCount,
            alive: true,
            path: [],
            pathIndex: 0,
            isBreaking: false,
            breakTarget: null,
            breakProgress: 0,
            speed: ATTACKER_SPEED + (attackers.length * 0.02),
            direction: { x: 1, y: 0 },
            breakPower: 1
        };

        calculatePath(attacker);
        attackers.push(attacker);
        return attacker;
    }

    function calculatePath(attacker) {
        const targetCol = HEATMAP_COLS - 1;
        const target = { col: targetCol, row: Math.floor(ROWS / 2) };
        const path = findPath(grid, attacker.col, attacker.row, target.col, target.row, attacker.id);
        attacker.path = path;
        attacker.pathIndex = 0;

        if (attacker.path.length === 0) {
            const dirs = [{ dc: 1, dr: 0 }, { dc: -1, dr: 0 }, { dc: 0, dr: 1 }, { dc: 0, dr: -1 }];
            for (const dir of dirs) {
                const nc = attacker.col + dir.dc;
                const nr = attacker.row + dir.dr;
                if (nc >= 0 && nc < COLS && nr >= 0 && nr < ROWS) {
                    const cell = grid[nr]?.[nc];
                    if (cell && !cell.isWall) {
                        const newPath = findPath(grid, nc, nr, target.col, target.row, attacker.id);
                        if (newPath.length > 0) {
                            attacker.path = newPath;
                            attacker.pathIndex = 0;
                            attacker.col = nc;
                            attacker.row = nr;
                            attacker.x = OFFSET_X + nc * CELL + CELL / 2;
                            attacker.y = OFFSET_Y + nr * CELL + CELL / 2;
                            break;
                        }
                    }
                }
            }
        }
    }

    function breakWall(attacker, cell) {
        if (!cell || !cell.isWall || cell.wallHealth <= 0) return false;

        if (cell.beingBrokenBy !== null && cell.beingBrokenBy !== attacker.id) {
            return false;
        }

        cell.beingBrokenBy = attacker.id;
        cell.wallHealth -= attacker.breakPower;
        score += 10;

        if (cell.wallHealth <= 0) {
            cell.isWall = false;
            cell.isBlocked = false;
            cell.beingBrokenBy = null;
            wallCount--;
            score += 25;

            if (attackers.length < MAX_ATTACKERS && !gameOver) {
                const spawnCol = Math.min(cell.col + 1, HEATMAP_COLS - 2);
                const spawnRow = Math.max(0, Math.min(cell.row + (Math.random() > 0.5 ? 1 : -1), ROWS - 1));
                const spawnCell = grid[spawnRow]?.[spawnCol];
                if (spawnCell && !spawnCell.isWall) {
                    const newAttacker = spawnAttacker(spawnCol, spawnRow);
                } else {
                    const fallbackRow = Math.floor(Math.random() * ROWS);
                    const fallbackCell = grid[fallbackRow]?.[0];
                    if (fallbackCell && !fallbackCell.isWall) {
                        const newAttacker = spawnAttacker(0, fallbackRow);
                    }
                }
            }

            if (wallCount === 0) {
                gameOver = true;
                return true;
            }

            for (const a of attackers) {
                if (a.alive) {
                    calculatePath(a);
                }
            }

            return true;
        } else {
            cell.beingBrokenBy = null;
            return true;
        }
    }

    function updateAttacker(attacker) {
        if (!attacker.alive) return;

        const cell = grid[attacker.row]?.[attacker.col];

        if (cell && cell.isWall && cell.wallHealth > 0) {
            if (cell.beingBrokenBy !== null && cell.beingBrokenBy !== attacker.id) {
                calculatePath(attacker);
                return;
            }

            if (!attacker.isBreaking) {
                attacker.isBreaking = true;
                attacker.breakTarget = cell;
                attacker.breakProgress = 0;
                cell.beingBrokenBy = attacker.id;
            }
        }

        if (attacker.isBreaking && attacker.breakTarget) {
            attacker.breakProgress += 0.025;
            if (attacker.breakProgress >= 1) {
                const broken = breakWall(attacker, attacker.breakTarget);
                attacker.isBreaking = false;
                attacker.breakTarget = null;
                attacker.breakProgress = 0;
                if (broken) {
                    calculatePath(attacker);
                }
            }
            return;
        }

        if (attacker.path.length === 0 || attacker.pathIndex >= attacker.path.length) {
            calculatePath(attacker);
            if (attacker.path.length === 0) {
                const dirs = [{ dc: 1, dr: 0 }, { dc: -1, dr: 0 }, { dc: 0, dr: 1 }, { dc: 0, dr: -1 }];
                for (const dir of dirs) {
                    const nc = attacker.col + dir.dc;
                    const nr = attacker.row + dir.dr;
                    if (nc >= 0 && nc < COLS && nr >= 0 && nr < ROWS) {
                        const targetCell = grid[nr]?.[nc];
                        if (targetCell && !targetCell.isWall) {
                            attacker.col = nc;
                            attacker.row = nr;
                            attacker.x = OFFSET_X + nc * CELL + CELL / 2;
                            attacker.y = OFFSET_Y + nr * CELL + CELL / 2;
                            break;
                        }
                    }
                }
                return;
            }
        }

        if (attacker.path.length > 0 && attacker.pathIndex < attacker.path.length) {
            const step = attacker.path[attacker.pathIndex];

            if (step.isWall && step.wallCell) {
                const wallCell = step.wallCell;
                if (wallCell.beingBrokenBy !== null && wallCell.beingBrokenBy !== attacker.id) {
                    calculatePath(attacker);
                    return;
                }
                wallCell.beingBrokenBy = attacker.id;
                attacker.isBreaking = true;
                attacker.breakTarget = wallCell;
                attacker.breakProgress = 0;
                return;
            }

            const targetCell = grid[step.row]?.[step.col];
            if (targetCell && targetCell.isWall && targetCell.wallHealth > 0) {
                calculatePath(attacker);
                return;
            }

            const targetX = OFFSET_X + step.col * CELL + CELL / 2;
            const targetY = OFFSET_Y + step.row * CELL + CELL / 2;
            const dx = targetX - attacker.x;
            const dy = targetY - attacker.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < attacker.speed + 1) {
                attacker.col = step.col;
                attacker.row = step.row;
                attacker.x = targetX;
                attacker.y = targetY;
                attacker.pathIndex++;
            } else {
                attacker.x += (dx / dist) * attacker.speed;
                attacker.y += (dy / dist) * attacker.speed;
            }

            if (pathHistory.length < 800 && Math.floor(pathHistory.length / 3) !== Math.floor((pathHistory.length + 1) / 3)) {
                pathHistory.push({
                    col: Math.round(attacker.col),
                    row: Math.round(attacker.row),
                    player: attacker.playerNumber
                });
            }

            // Check if reached the target (before future area)
            if (attacker.col >= HEATMAP_COLS - 1) {
                gameOver = true;
                return;
            }
        }
    }

    spawnAttacker(0, 3);

    let steps = 0;
    const maxSteps = 5000;

    while (!gameOver && steps < maxSteps && attackers.length > 0) {
        steps++;
        const sortedAttackers = [...attackers].sort((a, b) => a.id - b.id);

        for (const attacker of sortedAttackers) {
            if (attacker.alive) {
                updateAttacker(attacker);
                if (gameOver) break;
            }
        }

        const aliveCount = attackers.filter(a => a.alive).length;
        if (aliveCount === 0 && wallCount > 0) {
            spawnAttacker(0, 3);
        }
    }

    return {
        attackers,
        grid,
        wallCount,
        score,
        gameOver,
        pathHistory,
        steps,
        totalAttackers: attackerCount
    };
}


function buildAnimationPath(pathHistory) {
    const targetRow = Math.floor(ROWS / 2);
    const startCol = 0;
    const endCol = HEATMAP_COLS - 1;

    if (pathHistory.length === 0) {
        const points = [];

        for (let col = startCol; col <= endCol; col++) {
            points.push({
                x: OFFSET_X + col * CELL + CELL / 2,
                y: OFFSET_Y + targetRow * CELL + CELL / 2
            });
        }

        for (let col = endCol - 1; col >= startCol; col--) {
            points.push({
                x: OFFSET_X + col * CELL + CELL / 2,
                y: OFFSET_Y + targetRow * CELL + CELL / 2
            });
        }

        return points;
    }

    const points = [];
    const sampleRate = Math.max(1, Math.floor(pathHistory.length / 200));


    for (let i = 0; i < pathHistory.length; i += sampleRate) {
        const step = pathHistory[i];
        points.push({
            x: OFFSET_X + step.col * CELL + CELL / 2,
            y: OFFSET_Y + step.row * CELL + CELL / 2
        });
    }

    const lastStep = pathHistory[pathHistory.length - 1];
    points.push({
        x: OFFSET_X + endCol * CELL + CELL / 2,
        y: OFFSET_Y + targetRow * CELL + CELL / 2
    });

    for (let i = pathHistory.length - 1; i >= 0; i -= sampleRate) {
        const step = pathHistory[i];
        points.push({
            x: OFFSET_X + step.col * CELL + CELL / 2,
            y: OFFSET_Y + step.row * CELL + CELL / 2
        });
    }

    points.push({
        x: OFFSET_X + startCol * CELL + CELL / 2,
        y: OFFSET_Y + targetRow * CELL + CELL / 2
    });

    console.log(`Created loop path: ${points.length} points (past → edge of future → past)`);
    return points;
}

function cellColor(cell) {
    if (!cell) return { fill: '#1c2333', stroke: '#2d3748' };
    if (cell.isFuture) return { fill: '#34ebcf', stroke: '#a646eb' };
    if (cell.isWall && cell.wallHealth > 0) {
        const healthPercent = cell.wallHealth / cell.maxWallHealth;
        const red = Math.floor(100 + (1 - healthPercent) * 155);
        return { fill: `rgb(${red}, 30, 30)`, stroke: `rgb(${red + 30}, 40, 40)` };
    }
    if (cell.hasCommit) {
        const intensity = Math.min(cell.commitCount / 5, 1);
        const green = Math.floor(30 + intensity * 70);
        return { fill: `rgb(10, ${green}, 10)`, stroke: `rgb(10, ${green + 20}, 10)` };
    }
    return { fill: '#161b22', stroke: '#21262d' };
}

function buildSvg(grid, simulation) {
    const rects = [];
    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            const { fill, stroke } = cellColor(grid[row]?.[col]);
            const x = OFFSET_X + col * CELL;
            const y = OFFSET_Y + row * CELL;
            rects.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="${fill}" stroke="${stroke}" stroke-width="0.5"/>`);
        }
    }

    const pathPoints = buildAnimationPath(simulation.pathHistory);
    let pathD = '';
    for (let i = 0; i < pathPoints.length; i++) {
        const p = pathPoints[i];
        if (i === 0) {
            pathD += `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
        } else {
            pathD += ` L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
        }
    }
    pathD += ' Z';

    const durationSec = Math.max(15, Math.round(pathPoints.length * 0.1));
    console.log(` Animation duration: ${durationSec}s for ${pathPoints.length} points`);
    console.log(`Path: Past (col 0) → Edge of Future (col ${HEATMAP_COLS - 1}) → Past (col 0)`);

    const futureCol = HEATMAP_COLS + Math.floor(BUFFER_COLS / 2);
    const futureRow = Math.floor(ROWS / 2);
    const future = {
        x: OFFSET_X + futureCol * CELL + CELL / 2,
        y: OFFSET_Y + futureRow * CELL + CELL / 2
    };
    const futureSize = CELL * 4.5;
    const spriteSize = CELL * 4;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#0d1117"/>
  ${rects.join('\n  ')}
  
  <!-- Future GIF (stays in place, never moving) -->
  <image href="${FUTURE_GIF}" x="${future.x - futureSize / 2}" y="${future.y - futureSize / 2}" width="${futureSize}" height="${futureSize}"/>
  
  <!-- Attacker GIF - Moves from past to edge of future and back -->
  <image href="${ATTACKER_GIF}" x="${-spriteSize / 2}" y="${-spriteSize / 2}" width="${spriteSize}" height="${spriteSize}">
    <animateMotion dur="${durationSec}s" repeatCount="indefinite" path="${pathD}"/>
  </image>
</svg>`;
}

async function main() {
    console.log(`Generating heatmap for ${USERNAME}...`);

    try {
        const contributions = await fetchContributions(USERNAME);
        const grid = buildGrid(contributions);

        const simulation = simulateGame(grid);

        console.log(`Simulation complete:`);
        console.log(`   - Steps: ${simulation.steps}`);
        console.log(`   - Attackers spawned: ${simulation.totalAttackers}`);
        console.log(`   - Walls remaining: ${simulation.wallCount}`);
        console.log(`   - Score: ${simulation.score}`);
        console.log(`   - Game over: ${simulation.gameOver}`);
        console.log(`   - Path steps recorded: ${simulation.pathHistory.length}`);

        const svg = buildSvg(grid, simulation);
        await writeFile(OUTPUT_PATH, svg, 'utf8');

        console.log(` Wrote ${OUTPUT_PATH}`);

    } catch (err) {
        console.error('❌ Error:', err);
        process.exit(1);
    }
}

main();