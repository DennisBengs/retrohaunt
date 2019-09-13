'use strict';

/**
 * @file game.js
 * @version 1.0.0
 * @author Donitz 2019
 */

////////////////////////////////////////////////////////////////////////
// Input

const keyHeld = new Set();

addEventListener('keydown', e => {
    keyHeld.add(e.keyCode)
    if (e.keyCode === 77) {
        muted = !muted;
        if (muted) {
            stopMusic(false);
        } else {
            playMusic(currentMusic);
        }
    }
});
addEventListener('keyup', e => keyHeld.delete(e.keyCode));

////////////////////////////////////////////////////////////////////////
// Game state

const trackSpecial = [[4, 6, 7, 9], [5, 6, 8, 9]];
const playerVelocity = 18;
const outroLevelIndex = 32;

let playerShape;
let timeRate = 1;
let restartLevel;
let interlacingPatterns;
let quake = 0;
let timeUntilStart = 0;
let mapX = 3;
let mapY = 7;
let playerDirection = 1;

////////////////////////////////////////////////////////////////////////
// Main loop

let lastTime = 0;
const render = time => {
    let elapsedSeconds = Math.min((time - lastTime) / 1000, .02);
    lastTime = time;

    elapsedSeconds *= (timeUntilStart -= elapsedSeconds) < 0;

    requestAnimationFrame(render);

    quake *= .95;
    cameraX = cameraX * .9 + (Math.random() - .5) * quake;
    cameraY = cameraY * .9 + (Math.random() - .5) * quake;

    update(-stepInterval);
    update(elapsedSeconds * timeRate + stepInterval);

    const oldTimeRate = timeRate;
    timeRate = 1;
    let pattern = 0;

    if (playerShape !== undefined) {
        shapes.forEach(shape => seq(0, 2).map(a => {
            const special = shape[9] & 31;
            if (trackSpecial[a].includes(special) && (oldTimeRate > 0 || special > 6) && !isTimelocked(shape)) {
                const d = playerShape[a] - shape[a];
                const v = elapsedSeconds * shape[5];
                shape[a] += Math.abs(d) < v ? d : v * Math.sign(d);
            }
        }));

        const input = [
            -(keyHeld.has(37) || keyHeld.has(65)) + (keyHeld.has(39) || keyHeld.has(68)),
            -(keyHeld.has(38) || keyHeld.has(87)) + (keyHeld.has(40) || keyHeld.has(83))];
        const velocity = input.map(v => v * playerVelocity * elapsedSeconds);
        const velocitySum = Math.abs(velocity[0]) + Math.abs(velocity[1]);

        let i = 0;
        playerShape[i] += velocity[i];
        i++;
        playerShape[i] += velocity[i];
        playerDirection = Math.sign(velocity[0]) || playerDirection;

        playerShape[16] = playerShape[3] = playerDirection * 2;

        tempKeys.add(0);
        if (!velocitySum && (playerShape[6] % 0.4) < 0.05) {
            tempKeys.delete(0);
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.lineJoin = 'round';

        shapes.map((shape, i) => getRoot(shape) !== playerShape && drawShape(shape, `rgb(0,${i + 1},0)`, '#f00', 2));

        if (timeUntilStart < 0) {
            for (let d = 0; d < 9; d++) {
                const x = playerShape[0] * positionStep + arenaSizeX / 2;
                const y = playerShape[1] * positionStep + arenaSizeY / 2;

                const dx = Math.cos(d / 4 * Math.PI) * 10 * (d < 8);
                const dy = Math.sin(d / 4 * Math.PI) * 10 * (d < 8);

                const pixel = ctx.getImageData(x + dx, y + dy, 1, 1).data;
                let blocked = !pixel[1] && !pixel[0];
                if (pixel[1] && !pixel[0]) {
                    const shape = shapes[pixel[1] - 1];
                    const type = shape[8];
                    const special = shape[9] & 31;
                    if (d === 8 && type === 7) {
                        quake = 10;
                        restartLevel();
                        sounds[5]();
                        timeUntilStart = 0.5;
                        return;
                    } else if (type === 2 || type === 3) {
                        blocked = true;
                    } else if (type === 4) {
                        timeRate = -1;
                        pattern = 1;
                    } else if (type === 5) {
                        timeRate = 0;
                        pattern = 2;
                    } else if (type === 6) {
                        timeRate = +(velocitySum > 0);
                        pattern = 3;
                    }
                    if (special === 10) {
                        playerShape[1] = -1000;
                    } else if (special === 11) {
                        keys.add(shape[10]);
                    } else if (special === 12) {
                        keys.delete(shape[10]);
                    } else if (special === 13) {
                        tempKeys.add(shape[10]);
                    }
                }
                if (blocked && d < 8) {
                    const l = Math.sqrt(dx ** 2 + dy ** 2);
                    playerShape[0] -= dx / l * elapsedSeconds * playerVelocity * 1.1;
                    playerShape[1] -= dy / l * elapsedSeconds * playerVelocity * 1.1;
                }
            }
        }

        const oldMapX = mapX;
        const oldMapY = mapY;
        mapX += -(playerShape[0] < -38) + (playerShape[0] > 38);
        mapY += -(playerShape[1] < -21) + (playerShape[1] > 21);
        if (oldMapX !== mapX || oldMapY !== mapY) {
            travel(
                oldMapX < mapX ? -36 : oldMapX > mapX ? 36 : playerShape[0],
                oldMapY < mapY ? -19 : oldMapY > mapY ? 19 : playerShape[1]);
            cameraX += (oldMapX - mapX) * arenaSizeX;
            cameraY += (oldMapY - mapY) * arenaSizeY;
            timeUntilStart = .7;
        }
    }

    ctx.fillStyle = typeFillStyle[2];
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    shapes.map(shape => drawShape(shape, typeFillStyle[shape[8]], typeStrokeStyle[shape[8]], typeLineWidth[shape[8]]));

    ctx.fillStyle = interlacingPatterns[pattern];
    ctx.translate(totalSeconds * 4, 0);
    ctx.fillRect(-totalSeconds * 4, 0, canvas.width, canvas.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = 'rgba(0, 0, 0, .4)';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);
};

////////////////////////////////////////////////////////////////////////
// Start

const handleResize = () => {
    canvas.width = arenaSizeX;
    canvas.height = arenaSizeY;
    const a = arenaSizeX / arenaSizeY;
    let x = 0;
    let y = (innerHeight - innerWidth / a) / 2;
    let s = innerWidth / arenaSizeX;
    if ((innerWidth / innerHeight) > a) {
        x = (innerWidth - innerHeight * a) / 2;
        y = 0;
        s = innerHeight / arenaSizeY;
    }
    canvas.style.width = `${arenaSizeX * s}px`;
    canvas.style.height = `${arenaSizeY * s}px`;
    canvas.style.left = `${x}px`;
    canvas.style.top = `${y}px`;
};

const travel = (startX, startY) => {
    const oldKeys = keys;
    restartLevel = () => {
        const index = mapX * 8 + mapY;
        if (index < 0 || index > 63) {
            return;
        }

        keys = new Set(oldKeys);
        tempKeys.clear();

        startLevels(index === outroLevelIndex ? [index] : [index, 0]);

        playerShape = shapes.find(shape => (shape[9] & 31) === 1);
        if (playerShape !== undefined) {
            playerShape[0] = startX;
            playerShape[1] = startY;
        }
    };
    restartLevel();
};

addEventListener('load', () => {
    setupCanvas();

    interlacingPatterns = [0, 250, 300, 200].map(v => createPattern(100, 100, (x, y) =>
        `hsla(${v}, 100%, ${(v > 0) * 10}%, ${.1 + (y % 2) * .2 + Math.random() * .2})`));

    addEventListener('resize', handleResize);
    handleResize();

    travel(0, 0);
    render(0);
});
