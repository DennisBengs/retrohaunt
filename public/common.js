'use strict';

/**
 * @file common.js
 * @version 1.0.0
 * @author Donitz 2019
 */

/*
 * Levels structure:
 *  shape_count (byte)
 *  0: shapes [
 *      0: x (byte) -> (int8)
 *      1: y (byte) -> (int8)
 *      2: angle (byte) -> (int8)
 *      3: scale_x (byte) -> (int8)
 *      4: scale_y (byte) -> (int8)
 *      5: context
 *      6: time
 *      7: parent (byte) -> (object)
 *      8: type (byte) ->
 *          0: open 1
 *          1: open 2
 *          2: wall 1
 *          3: wall 2
 *          4: reverse
 *          5: stop
 *          6: superhot
 *          7: hazard
 *      9: special (byte) ->
 *          bit 6: timelock
 *          bit 7: wave
 *          bit 8: loop
 *          0: none
 *          1: player
 *          2: x time
 *          3: y time
 *          4: track x
 *          5: track y
 *          6: track xy
 *          7: track x timeless
 *          8: track y timeless
 *          9: track xy timeless
 *          10: exit
 *          11: proximity set key
 *          12: proximity unset key
 *          13: proximity temporary set key
 *          14: context set key - 1
 *          16-31: sound
 *      10: key (byte)
 *      vertex_count (byte)
 *      11: vertices [
 *          x0, y0, x1, y2... (byte) -> (int8)
 *      ]
 *      parameter_count (byte)
 *      12: parameters [
 *          0: parameter (byte)
 *          point_count (byte)
 *          1: points [
 *              0: duration (byte)
 *              1: y (byte) -> (int8)
 *          ]
 *      ]
 *  ]
 */

////////////////////////////////////////////////////////////////////////
// Helper functions

const lerp = (a, b, t) => a * (1 - t) + b * t;
const createArray = n => [...Array(n)];
const seq = (from, to) => [...Array(to - from)].map((_, i) => from + i);
const createPattern = (sizeX, sizeY, colorFunc) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = sizeX;
    canvas.height = sizeY;
    seq(0, sizeX).map(x => seq(0, sizeY).map(y => {
        ctx.fillStyle = colorFunc(x, y);
        ctx.fillRect(x, y, 1, 1);
    }));
    return ctx.createPattern(canvas, 'repeat');
};
const getRoot = shape => {
    while (shape[7]) {
        shape = shape[7];
    }
    return shape;
};
const isTimelocked = shape => !editor && (shape[9] & 32) && !(keys.has(shape[10]) || tempKeys.has(shape[10]));

////////////////////////////////////////////////////////////////////////
// Settings

const stepInterval = .05;

const arenaSizeX = 640;
const arenaSizeY = 368;

const positionStep = 8;
const scaleStep = .1;
const angleStep = 5;
const timeStep = .1;

////////////////////////////////////////////////////////////////////////
// Game state

let levels;
let shapes;
let step;
let totalSeconds;
let stepFraction;
let editor = false;
let keys = new Set();
let tempKeys = new Set();

////////////////////////////////////////////////////////////////////////
// Canvas

let cameraX = 0;
let cameraY = 0;

let canvas;
let ctx;

let typeFillStyle;
let typeStrokeStyle;
const typeLineWidth = [2, 0, 2, 7, 7, 7, 0, 0, 0];

const setupCanvas = () => {
    canvas = document.querySelector('canvas');
    ctx = canvas.getContext('2d');

    typeFillStyle = [
        '#4b0072',
        '#9800e5',
        '#000',
        createPattern(2, 2, (x, y) => (x + y) % 2 ? '#cf0d67' : '#000'),
        createPattern(1, 2, (x, y) => y % 2 ? 'transparent' : '#454a98'),
        createPattern(1, 2, (x, y) => y % 2 ? 'transparent' : '#864598'),
        createPattern(1, 2, (x, y) => y % 2 ? 'transparent' : '#458a98'),
        '#cf0d67',
        '#000'];
    typeStrokeStyle = typeFillStyle.map((color, i) => typeLineWidth[i] ? createPattern(2, 2, (x, y) => !((x + y) % 2) ? 'transparent' : color) : 'transparent');
};

////////////////////////////////////////////////////////////////////////
// Level loading

const loadLevels = () => {
    let i = 0;
    levels = createArray(levelData[i++]).map(
        () => createArray(levelData[i++]).map(
            () => [].concat(
                createArray(5).map(() => levelData[i++] - 128),
                0,
                0,
                createArray(4).map(() => levelData[i++]),
                [createArray(levelData[i++]).map(
                    () => createArray(2).map(() => levelData[i++] - 128))],
                [createArray(levelData[i++]).map(
                    () => [levelData[i++], createArray(levelData[i++]).map(
                        () => [levelData[i++], levelData[i++] - 128])])])));
}
loadLevels();

const startLevels = indices => {
    shapes = indices.map(i => {
        shapes = JSON.parse(JSON.stringify(levels[i]));
        shapes.map(shape => shape[7] = !shape[7] ? null : shapes[shape[7] - 1]);
        return shapes;
    }).flat(1);
    step = 0;
    totalSeconds = stepInterval;
};

////////////////////////////////////////////////////////////////////////
// Update game logic

const update = elapsedSeconds => {
    totalSeconds += elapsedSeconds;
    const targetStep = Math.floor(totalSeconds / stepInterval) + (elapsedSeconds > 0);
    stepFraction = Math.abs(totalSeconds - targetStep * stepInterval) / stepInterval;

    while (step !== targetStep) {
        const rate = (step < targetStep) * 2 - 1;
        step += rate;

        shapes.map((shape, si) => {
            seq(0, 7).map((v, i) => shape[13 + i] = shape[i]);

            const root = getRoot(shape);
            if (isTimelocked(shape)) {
                return;
            }

            const special = shape[9] & 31;
            shape[6] = (
                special === 2 && !editor ? root[0] * timeStep :
                special === 3 && !editor ? root[1] * timeStep :
                shape[6] + stepInterval * rate);
            shape[12].map(param => {
                const duration = param[1].reduce((sum, point) => sum + point[0] * timeStep, 0);
                let secondsLeft = shape[6 + 13 * (rate < 0)];
                if (shape[9] & 128) {
                    secondsLeft = (secondsLeft + duration * 1e8) % duration;
                }
                const l = param[1].length;
                seq(0, l).map(i => {
                    if (i === l - 1) {
                        return;
                    }
                    const point0 = param[1][i];
                    const point1 = param[1][(i + 1) % l];
                    if (secondsLeft >= 0 && secondsLeft < point0[0] * timeStep + 1e-10 && point0[0] > 0) {
                        const y = lerp(point0[1], point1[1], secondsLeft / point0[0] / timeStep);
                        const p = param[0];
                        if (p % 7 === 6) {
                            const t = new Date().getTime();
                            if (y > 0 && (!param[2] || t > param[2] + 1500)) {
                                param[2] = t;
                                const soundId = special - 16;
                                if (soundId >= 0 && soundId < sounds.length && !editor) {
                                    sounds[soundId]();
                                }
                            }
                        } else {
                            shape[p % 7] = p > 6 ? y : shape[p] + y * stepInterval * rate;
                        }
                    }
                    secondsLeft -= point0[0] * timeStep;
                });
            });

            if (special === 14 && shape[5] >= 0) {
                tempKeys.add(shape[10] - 1);
            }
        });
    }
};

////////////////////////////////////////////////////////////////////////
// Rendering

const setShapeTransform = shape => {
    const shapes = [];
    while (shape) {
        shapes.unshift(shape);
        shape = shape[7];
    }

    ctx.translate(-cameraX + arenaSizeX / 2, -cameraY + arenaSizeY / 2);
    ctx.scale(positionStep, positionStep);

    shapes.map(shape => {
        const [x, y, angle, scaleX, scaleY] = seq(0, 5).map(i => lerp(shape[i], shape[13 + i], stepFraction));

        ctx.translate(x, y);
        ctx.rotate(angle * angleStep * Math.PI / 180);
        ctx.scale(scaleX * scaleStep, scaleY * scaleStep);
    });
};

const wave = (a, b, c) => a + Math.sin((totalSeconds + a + b) * 5) * c;

const drawShape = (shape, fillStyle, strokeStyle, lineWidth) => {
    setShapeTransform(shape);

    const waveMagnitude = ((shape[9] & 64) > 0) / 2;

    ctx.beginPath();
    if (shape[11].length < 3) {
        const point = shape[11][0];
        ctx.arc(point[0], point[1], 4, 0, 2 * Math.PI);
    } else {
        shape[11].map((point, i) => {
            const x = wave(point[0], point[1], waveMagnitude);
            const y = wave(point[1], point[0], waveMagnitude);
            if (!i) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
    }
    ctx.closePath();

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
};
