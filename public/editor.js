'use strict';

/**
 * @file editor.js
 * @version 1.0.0
 * @author Donitz 2019
 */

////////////////////////////////////////////////////////////////////////
// Helper functions

const clamp = (min, val, max) => Math.max(min, Math.min(max, val));
const transformMatrix = () => new DOMMatrix(ctx.mozCurrentTransform || ctx.currentTransform);
const transformPoint = (x, y) => {
    const m = transformMatrix();
    return [
        x * m.a + y * m.c + m.e,
        x * m.b + y * m.d + m.f];
};
const inverseTransformPoint = (x, y) => {
    const m = transformMatrix().invertSelf();
    return [
        x * m.a + y * m.c + m.e,
        x * m.b + y * m.d + m.f];
};
const transformDirection = (x, y) => {
    const m = transformMatrix();
    const x1 = x * m.a + y * m.c;
    const y1 = x * m.b + y * m.d;
    const l0 = Math.sqrt(x * x + y * y);
    const l1 = Math.sqrt(x1 * x1 + y1 * y1);
    return [(x1 / l1) * l0, (y1 / l1) * l0];
};

////////////////////////////////////////////////////////////////////////
// Input

const keyDown = new Set();
const keyHeld = new Set();
const mouseDown = new Set();
const mouseHeld = new Set();

let mouseX = 0;
let mouseY = 0;

let lastMouseX = 0;
let lastMouseY = 0;

addEventListener('keydown', e => {
    if (!e.repeat) {
        keyDown.add(e.keyCode);
        keyHeld.add(e.keyCode);
    }
});
addEventListener('keyup', e => {
    if (!e.repeat) {
        keyDown.delete(e.keyCode);
        keyHeld.delete(e.keyCode);
    }
});
addEventListener('mousemove', e => {
    if (canvas !== undefined) {
        const rect = canvas.getBoundingClientRect();
        mouseX = e.clientX - rect.left;
        mouseY = e.clientY - rect.top;
    }
});
addEventListener('mousedown', e => {
    if (!e.repeat) {
        mouseDown.add(e.button);
        mouseHeld.add(e.button);
    }
});
addEventListener('mouseup', e => {
    if (!e.repeat) {
        mouseDown.delete(e.button);
        mouseHeld.delete(e.button);
    }
});

const wasKeyPressed = keyCode => {
    const temp = keyDown.has(keyCode);
    keyDown.delete(keyCode);
    return temp;
};
const wasButtonPressed = button => {
    const temp = mouseDown.has(button);
    mouseDown.delete(button);
    return temp;
};

////////////////////////////////////////////////////////////////////////
// Editor

const parameterPanelSeconds = 10;

const defaultVertices = [[-4, -4], [4, -4], [4, 4], [-4, 4]];
const defaultScale = 10;

const scaleRate = .2;

const maxShapes = 200;

const setZeroTime = () => {
    update(-totalSeconds - stepInterval + 1e-10);
    update(1e-10);
};

const setEditorTime = () => update(editorSeconds - totalSeconds);

let panningParameterPanel = false;

let editorSeconds = -1e-10;
let levelIndex = 0;

let mode = null;

let selectedShape = null;
let selectedParameterIndex = 0;
let getSelectedParameter = () => selectedShape[12].find(param => param[0] === selectedParameterIndex) || null;
let selectedPoint = null;
let selectedPointIndex;
let selectedPointIsParameter;
let selectedPointIsNew;

let startRotation;
let newRotation;
let newScaleX;
let newScaleY;

////////////////////////////////////////////////////////////////////////
// Main loop

let lastTime = 0;
const render = time => {
    const elapsedSeconds = (time - lastTime) / 1000;
    lastTime = time;

    const deltaMouseX = lastMouseX - mouseX;
    const deltaMouseY = lastMouseY - mouseY;

    lastMouseX = mouseX;
    lastMouseY = mouseY;

    const hoveringParameterPanel = mouseX > canvas.width / 2;
    const parameterPanelYScale = window.innerHeight / -280;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    ctx.lineJoin = 'round';

    editorSeconds = keyHeld.has(87) ? -1e-10 : editorSeconds + (keyHeld.has(81) ? -1 : keyHeld.has(69) ? 1 : 0) * elapsedSeconds;

    // Start panning
    if (wasButtonPressed(1)) {
        panningParameterPanel = hoveringParameterPanel;
    }

    // Pan
    if (mouseHeld.has(1)) {
        if (panningParameterPanel) {
            if (mode === null) {
                editorSeconds += deltaMouseX / canvas.width * parameterPanelSeconds;
            }
        } else {
            cameraX += deltaMouseX;
            cameraY += deltaMouseY;
        }
    }

    // Set parent/Select shape
    if (wasButtonPressed(2) || mode === 'set_parent' && wasButtonPressed(0)) {
        if (mode !== null && mode !== 'set_parent') {
            mode = null;
        } else {
            let found = false;
            for (let i = 0; i < 2; i++) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                shapes.slice(0).reverse().map((shape, n) => {
                    if (found) {
                        return;
                    }

                    drawShape(shape, `rgb(${n + 1},0,0)`, '#000', 0);

                    if (ctx.getImageData(mouseX, mouseY, 1, 1).data[0] !== n + 1) {
                        return;
                    }

                    if (mode === 'set_parent') {
                        let parent = shape;
                        while (parent[7] && parent !== selectedShape) {
                            parent = parent[7];
                        }
                        if (parent !== selectedShape) {
                            selectedShape[7] = shape;
                            selectedShape[0] = 0;
                            selectedShape[1] = 0;
                            found = true;
                        }
                    } else if (selectedShape === null) {
                        selectedShape = shape;
                        found = true;
                    } else if (shape === selectedShape) {
                        selectedShape = null;
                        selectedPoint = null;
                        mode = null;
                    }
                });

                if (mode === 'set_parent') {
                    mode = null;
                } else if (!found) {
                    selectedShape = null;
                    selectedPoint = null;
                    mode = null;
                }
            }
        }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Rewind
    setZeroTime();

    // Create shape
    if (wasKeyPressed(65) && shapes.length < maxShapes) {
        const shape = [0, 0, 0, defaultScale, defaultScale, 0, 0, null, 0, 0, 0, defaultVertices.map(point => point.slice(0)), []];
        shapes.push(shape);
        selectedShape = shape;
        mode = 'move';
    }

    // Select parameter index
    seq(49, 56).map(keyCode => {
        if (wasKeyPressed(keyCode)) {
            selectedParameterIndex = keyCode - 49 + 7 + - 7 * keyHeld.has(18);

            selectedPoint = null;
            mode = null;
        }
    });

    // Save/Revert/Next/Previous level
    if (wasKeyPressed(67) || wasKeyPressed(88) || wasKeyPressed(33) || wasKeyPressed(34)) {
        if (!keyHeld.has(88)) {
            shapes.map(shape => {
                shape[7] = shapes.indexOf(shape[7]) + 1;
                shape[12] = shape[12].filter(param => param[1].length > 1);
            });
            levels[levelIndex] = JSON.parse(JSON.stringify(shapes));

            const data = (
                [levels.length].concat(
                    levels.map(shapes =>
                        [shapes.length].concat(
                            shapes.map(
                                shape => [].concat(
                                    shape.slice(0, 5).map(v => v + 128),
                                    shape.slice(7, 11),
                                    shape[11].length,
                                    shape[11].map(
                                        point => point.map(v => v + 128)),
                                    shape[12].length,
                                    shape[12].map(
                                        param => [param[0]].concat(param[1].length, param[1].map(
                                            point => [point[0], point[1] + 128])))
                                )
                            )
                        )
                    )
                ).flat(5).map(v => Math.max(0, Math.min(255, Math.round(v)))));

            if (keyHeld.has(67)) {
                window.open(`data:text/plain;charset=utf-8,const levelData = [${data.join(',')}];`);
                keyHeld.delete(67);
            }
        }
        levelIndex = Math.max(0, Math.min(levels.length - 1, levelIndex + (keyHeld.has(33) ? 1 : keyHeld.has(34) ? -1 : 0)));
        startLevels([levelIndex]);

        selectedShape = null;
        selectedPoint = null;
        mode = null;
    }

    // Clear level
    if (wasKeyPressed(90)) {
        shapes.length = 0;

        selectedShape = null;
        selectedPoint = null;
        mode = null;
    }

    // Shape interactions
    if (selectedShape !== null) {
        setShapeTransform(selectedShape);
        const localSpaceMouse = inverseTransformPoint(mouseX, mouseY);
        const parentSpaceShapePosition = transformPoint(0, 0);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        setShapeTransform(selectedShape[7]);
        const arenaSpaceMouse = inverseTransformPoint(mouseX, mouseY);
        const angleToShape = Math.atan2(parentSpaceShapePosition[1] - mouseY, parentSpaceShapePosition[0] - mouseX) * 180 / Math.PI;
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        const paramSeconds = editorSeconds + ((mouseX - canvas.width * .75) / (canvas.width / 2)) * parameterPanelSeconds;
        const paramY = clamp(-128, Math.round((mouseY - window.innerHeight / 2) / parameterPanelYScale), 127);
        const selectedParameter = getSelectedParameter();

        // Editing mode
        switch (mode) {
            case null:
                if (!hoveringParameterPanel) {
                    // Select existing or new vertex
                    selectedPoint = null;
                    selectedPointIsParameter = false;
                    selectedPointIsNew = true;

                    const l = selectedShape[11].length;
                    if (l === 1) {
                        selectedPoint = selectedShape[11][0].slice(0);
                    } else {
                        let nearestDistance = 5;
                        for (let i = 0; i < l; i++) {
                            const px = localSpaceMouse[0];
                            const py = localSpaceMouse[1];
                            const l0 = selectedShape[11][i];
                            const l1 = selectedShape[11][(i + 1) % l];
                            const lengthSqr = (l0[0] - l1[0]) ** 2 + (l0[1] - l1[1]) ** 2;
                            const dx = l1[0] - l0[0];
                            const dy = l1[1] - l0[1];
                            const t = Math.max(0, Math.min(1, ((px - l0[0]) * dx + (py - l0[1]) * dy) / lengthSqr));
                            const x = l0[0] + t * dx;
                            const y = l0[1] + t * dy;
                            const newDistance = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
                            if (newDistance < nearestDistance) {
                                const tolerance = 1.5 / Math.sqrt(lengthSqr);
                                nearestDistance = newDistance;
                                selectedPointIndex = i;
                                selectedPointIsNew = t >= tolerance && t <= 1 - tolerance;
                                selectedPoint = selectedPointIsNew && selectedShape[9].length === 255 ? null : t < tolerance ? l0 : t > 1 - tolerance ? l1 : [x, y];
                            }
                        }
                    }
                } else {
                    // Select existing or new parameter point
                    selectedPoint = selectedParameter !== null && selectedParameter[1].length === 255 ? null : [0, paramY];
                    selectedPointIsParameter = true;
                    selectedPointIsNew = true;

                    if (selectedParameter !== null) {
                        let nearestDistance = window.innerHeight / 40;
                        let seconds = 0;
                        selectedParameter[1].map((point, i) => {
                            const x = ((seconds + parameterPanelSeconds / 2 - editorSeconds) / parameterPanelSeconds + 1) * canvas.width / 2;
                            const y = canvas.height / 2 + point[1] * parameterPanelYScale;

                            const newDistance = Math.sqrt((mouseX - x) ** 2 + (mouseY - y) ** 2);
                            if (newDistance < nearestDistance) {
                                nearestDistance = newDistance;
                                selectedPoint = point;
                                selectedPointIndex = i;
                                selectedPointIsNew = false;
                            }
                            seconds += point[0] * timeStep;
                        });
                    }
                }
                break;
            case 'dragging_point':
                // Move point
                if (selectedPointIsParameter) {
                    while (true) {
                        const i = selectedParameter[1].indexOf(selectedPoint);
                        const seconds = selectedParameter[1].reduce((sum, point, n) => n < i - 1 ? sum + point[0] * timeStep : sum, 0);
                        if (i > 0) {
                            const previous = selectedParameter[1][i - 1];
                            previous[0] = Math.min(Math.round((paramSeconds - seconds) / timeStep), 255);
                            if (previous[0] < 0) {
                                selectedParameter[1].splice(i - 1, 1);
                                continue;
                            }
                        }
                        break;
                    }
                    selectedPoint[1] = clamp(-128, paramY, 127);
                } else {
                    selectedPoint[0] = clamp(-128, Math.round(localSpaceMouse[0]), 127);
                    selectedPoint[1] = clamp(-128, Math.round(localSpaceMouse[1]), 127);
                }

                // Drop dragging point
                if (!mouseHeld.has(0)) {
                    if (!selectedPointIsParameter) {
                        const l = selectedShape[11].length;
                        for (let i = -1; i < 2; i += 2) {
                            const toRemove = selectedShape[11][(selectedShape[11].indexOf(selectedPoint) + i + l) % l];
                            if (toRemove !== selectedPoint &&
                                toRemove[0] === selectedPoint[0] &&
                                toRemove[1] === selectedPoint[1]) {
                                selectedShape[11] = selectedShape[11].filter(point => point !== toRemove);
                                break;
                            }
                        }
                    }
                    selectedPoint = null;
                    mode = null;
                }
                break;
            case 'move':
                selectedShape[0] = clamp(-128, Math.round(arenaSpaceMouse[0]), 127);
                selectedShape[1] = clamp(-128, Math.round(arenaSpaceMouse[1]), 127);
                mode = wasButtonPressed(0) || wasButtonPressed(2) ? null : mode;
                break;
            case 'rotate':
                let angle = newRotation + (angleToShape - startRotation);
                while (angle <= -180) angle += 360;
                while (angle > 180) angle -= 360;
                selectedShape[2] = Math.round(angle / angleStep);
                mode = wasButtonPressed(0) || wasButtonPressed(2) ? null : mode;
                break;
            case 'scale':
                newScaleX -= deltaMouseX * scaleRate;
                newScaleY += deltaMouseY * scaleRate;
                selectedShape[3] = clamp(-128, Math.round(newScaleX), 127);
                selectedShape[4] = clamp(-128, Math.round(newScaleY), 127);
                mode = wasButtonPressed(0) || wasButtonPressed(2) ? null : mode;
                break;
            case 'set_parent':
                mode = wasButtonPressed(0) || wasButtonPressed(2) ? null : mode;
                break;
        }

        // Move vertices using arrows
        const pointDeltaX = -wasKeyPressed(37) + wasKeyPressed(39);
        const pointDeltaY = -wasKeyPressed(38) + wasKeyPressed(40);
        if (pointDeltaX || pointDeltaY) {
            selectedShape[11].forEach(point => {
                point[0] += pointDeltaX;
                point[1] += pointDeltaY;
            });
        }

        // Start dragging point
        if (mode === null && wasButtonPressed(0) && selectedPoint !== null) {
            if (selectedPointIsNew) {
                if (selectedPointIsParameter) {
                    if (selectedParameter === null) {
                        selectedShape[12].push([selectedParameterIndex, [selectedPoint]]);
                    } else if (selectedPointIsNew) {
                        selectedParameter[1].push(selectedPoint);
                    }
                } else {
                    selectedShape[11].splice(selectedPointIndex + 1, 0, selectedPoint);
                }
            }
            mode = 'dragging_point';
        }

        // Move
        if (wasKeyPressed(71)) {
            mode = 'move';
        }

        // Rotate
        if (wasKeyPressed(82)) {
            mode = 'rotate';
            newRotation = selectedShape[2] * angleStep;
            startRotation = angleToShape;
        }

        // Scale
        if (wasKeyPressed(83)) {
            mode = 'scale';
            newScaleX = selectedShape[3];
            newScaleY = selectedShape[4];
        }

        // Set parent
        if (wasKeyPressed(80)) {
            selectedShape[7] = null;
            mode = 'set_parent';
        }

        // Clear parameter
        if (wasKeyPressed(73)) {
            selectedShape[12] = selectedShape[12].filter(param => param[0] !== selectedParameterIndex);
            selectedPoint = null;
        }

        // Type
        if (wasKeyPressed(84)) {
            selectedShape[8] = (selectedShape[8] + 1) % typeFillStyle.length;
        }

        // Loop
        if (wasKeyPressed(76)) {
            selectedShape[9] ^= 128;
        }

        // Wave
        if (wasKeyPressed(66)) {
            selectedShape[9] ^= 64;
        }

        // Timelock
        if (wasKeyPressed(79)) {
            selectedShape[9] ^= 32;
        }

        // Special
        if (wasKeyPressed(77)) {
            selectedShape[9] = (selectedShape[9] + 1) % 32 + (selectedShape[9] & 224);
        }

        // key
        if (wasKeyPressed(75)) {
            selectedShape[10] = (selectedShape[10] + 1) % 16;
        }

        // Send forward
        if (wasKeyPressed(171)) {
            const i = shapes.indexOf(selectedShape);
            if (i < shapes.length - 1) {
                const temp = shapes[i + 1];
                shapes[i + 1] = selectedShape;
                shapes[i] = temp;
            }
        }

        // Send backward
        if (wasKeyPressed(173)) {
            const i = shapes.indexOf(selectedShape);
            if (i > 0) {
                const temp = shapes[i - 1];
                shapes[i - 1] = selectedShape;
                shapes[i] = temp;
            }
        }

        // Duplicate
        if (wasKeyPressed(68) && shapes.length < maxShapes) {
            const shape = JSON.parse(JSON.stringify(selectedShape));
            shape[7] = selectedShape[7];
            shapes.push(shape);
            selectedShape = shape;
            mode = 'move';
        }

        // Delete
        if (wasKeyPressed(46)) {
            shapes.forEach(shape => {
                if (shape[7] === selectedShape) {
                    shape[7] = null;
                }
            });
            shapes.splice(shapes.indexOf(selectedShape), 1);
            selectedShape = null;
        }
    }

    setEditorTime();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = typeFillStyle[2];
    ctx.fillRect(-cameraX, -cameraY, arenaSizeX, arenaSizeY);

    shapes.map(shape => {
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        drawShape(shape,
            typeFillStyle[shape[8]],
            shape === selectedShape ? '#ff9f00' : '#550055',
            shape === selectedShape ? 2 : 1);
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
    });

    ctx.beginPath();
    for (let x = Math.floor(cameraX / positionStep) * positionStep; x < cameraX + canvas.width / 2; x += positionStep) {
        ctx.moveTo(x - cameraX, 0);
        ctx.lineTo(x - cameraX, canvas.height);
    }
    for (let y = Math.floor(cameraY / positionStep) * positionStep; y < cameraY + canvas.height; y += positionStep) {
        ctx.moveTo(0, y - cameraY);
        ctx.lineTo(canvas.width / 2, y - cameraY);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0, 255, 0, .1)';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(arenaSizeX / 2 - cameraX, 0);
    ctx.lineTo(arenaSizeX / 2 - cameraX, canvas.height);
    ctx.moveTo(0, arenaSizeY / 2 - cameraY);
    ctx.lineTo(canvas.width, arenaSizeY / 2 - cameraY);
    ctx.strokeStyle = 'rgba(0, 255, 0, .3)';
    ctx.stroke();

    ctx.lineWidth = 1;
    ctx.strokeStyle = '#00ff00';
    ctx.strokeRect(-cameraX, -cameraY, arenaSizeX, arenaSizeY);

    ctx.font = '14px monospace';

    ctx.fillStyle = '#006600';
    ctx.fillText('lmb: edit shape/curves', 10, 15);
    ctx.fillText('rmb: select', 10, 30);
    ctx.fillText('mmb: pan', 10, 45);
    ctx.fillText('a: add', 10, 75);
    ctx.fillText('delete: delete', 10, 90);
    ctx.fillText('d: duplicate', 10, 115);
    ctx.fillStyle = mode === 'move' ? '#00ff00' : '#006600';
    ctx.fillText('g: move', 10, 145);
    ctx.fillStyle = mode === 'rotate' ? '#00ff00' : '#006600';
    ctx.fillText('r: rotate', 10, 160);
    ctx.fillStyle = mode === 'scale' ? '#00ff00' : '#006600';
    ctx.fillText('s: scale', 10, 175);
    ctx.fillStyle = mode === 'set_parent' ? '#00ff00' : '#006600';
    ctx.fillText('p: set parent', 10, 190);
    ctx.fillStyle = '#006600';
    ctx.fillText('+: send forward', 10, 220);
    ctx.fillText('-: send backward', 10, 235);
    ctx.fillText('1-7: show parameter', 10, 265);
    ctx.fillText('alt+1-7: show delta parameter', 10, 280);
    ctx.fillText('i: clear parameter', 10, 295);
    ctx.fillText('w: rewind', 10, 325);
    ctx.fillText('q: play backwards', 10, 340);
    ctx.fillText('e: play forwards', 10, 355);
    ctx.fillText('x: revert changes', 10, 370);
    ctx.fillText('c: save level', 10, 385);
    ctx.fillText('z: clear level', 10, 400);
    ctx.fillText('page up: next level', 10, 415);
    ctx.fillText('page down: previous level', 10, 430);
    ctx.fillText(`level: ${levelIndex} (${Math.floor(levelIndex / 8)},${levelIndex % 8})`, 10, 445);

    if (selectedShape !== null) {
        let parent = selectedShape;
        while (parent !== null) {
            setShapeTransform(parent);
            const center = transformPoint(0, 0);
            const right = transformDirection(1, 0);
            const up = transformDirection(0, -1);
            ctx.setTransform(1, 0, 0, 1, 0, 0);

            ctx.beginPath();
            ctx.moveTo(center[0], center[1]);
            ctx.lineTo(center[0] + right[0] * 50, center[1] + right[1] * 50);

            ctx.lineWidth = 2;
            ctx.strokeStyle = parent === selectedShape ? '#ff0000' : '#880000';
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(center[0], center[1]);
            ctx.lineTo(center[0] + up[0] * 50, center[1] + up[1] * 50);

            ctx.strokeStyle = parent === selectedShape ? '#00ff00' : '#008800';
            ctx.stroke();

            if (parent === selectedShape) {
                selectedShape[11].concat(selectedPoint !== null && !selectedPointIsParameter ? [selectedPoint] : []).map(point => {
                    setShapeTransform(selectedShape);
                    const p = transformPoint(point[0], point[1]);
                    ctx.setTransform(1, 0, 0, 1, 0, 0);

                    ctx.beginPath();
                    ctx.arc(p[0], p[1], 5, 0, Math.PI * 2);
                    ctx.fillStyle = point === selectedPoint ? selectedPointIsNew ? '#00ffff' : '#ffff00' : '#ff00ff';
                    ctx.fill();
                });
            }

            parent = parent[7];
        }

        ctx.fillStyle = '#00ff00';
        ctx.fillText(`position: ${selectedShape[0].toFixed(2)},${selectedShape[1].toFixed(2)}`, 10, canvas.height - 100);
        ctx.fillText(`scale: ${(selectedShape[3] * scaleStep).toFixed(2)},${(selectedShape[4] * scaleStep).toFixed(2)}`, 10, canvas.height - 85);
        ctx.fillText(`angle: ${(selectedShape[2] * angleStep).toFixed(2)}`, 10, canvas.height - 70);
        ctx.fillText(`type (t): ${['open 1', 'open 2', 'wall 1', 'wall 2', 'reverse', 'stop', 'superhot', 'hazard', 'void'][selectedShape[8]]}`, 10, canvas.height - 55);
        ctx.fillText(`loop (l): ${(selectedShape[9] & 128) ? 'true' : 'false'}, wave (b): ${(selectedShape[9] & 64) ? 'true' : 'false'}, timelock (o): ${(selectedShape[9] & 32) ? 'true' : 'false'}`, 10, canvas.height - 40);
        const special = selectedShape[9] & 31;
        let specialText;
        switch (true) {
            case (special === 0):
                specialText = 'none';
                break;
            case (special === 1):
                specialText = 'player';
                break;
            case (special === 2):
                specialText = 'x time';
                break;
            case (special === 3):
                specialText = 'y time';
                break;
            case (special === 4):
                specialText = 'track player x (context = speed)';
                break;
            case (special === 5):
                specialText = 'track player y (context = speed)';
                break;
            case (special === 6):
                specialText = 'track player (context = speed)';
                break;
            case (special === 7):
                specialText = 'track player x timeless (context = speed)';
                break;
            case (special === 8):
                specialText = 'track player y timeless (context = speed)';
                break;
            case (special === 9):
                specialText = 'track player timeless (context = speed)';
                break;
            case (special === 10):
                specialText = 'exit';
                break;
            case (special === 11):
                specialText = 'proximity set key';
                break;
            case (special === 12):
                specialText = 'proximity unset key';
                break;
            case (special === 13):
                specialText = 'proximity temporary set key';
                break;
            case (special === 14):
                specialText = 'context set key -1 (context >= 0)';
                break;
            case (special === 15):
                specialText = 'unused';
                break;
            case (special < 16):
                specialText = 'none';
                break;
            case (special < 32):
                specialText = `sound id ${special - 16}`;
                break;
        }
        ctx.fillText(`special (m): ${special} (${specialText})`, 10, canvas.height - 25);
        ctx.fillText(`key (k): ${selectedShape[10]}`, 10, canvas.height - 10);
    }

    ctx.beginPath();
    ctx.rect(canvas.width / 2, 0, canvas.width / 2, canvas.height);
    ctx.fillStyle = '#003300';
    ctx.fill();
    ctx.clip();

    ctx.lineWidth = 1;
    ctx.strokeStyle = '#00ff00';
    ctx.strokeRect(canvas.width / 2, 0, canvas.width / 2, canvas.height);

    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.strokeStyle = '#008800';
    ctx.stroke();

    for (let seconds = Math.floor(editorSeconds - parameterPanelSeconds / 2); seconds < editorSeconds + parameterPanelSeconds / 2; seconds++) {
        const x = ((seconds + parameterPanelSeconds / 2 - editorSeconds) / parameterPanelSeconds + 1) * canvas.width / 2;

        ctx.beginPath();
        ctx.moveTo(x, 5);
        ctx.lineTo(x, canvas.height - 5);
        ctx.strokeStyle = '#008800';
        ctx.stroke();

        ctx.fillStyle = '#008800';
        ctx.fillText(seconds.toFixed(2), x + 5, canvas.height - 7);
    }

    ctx.beginPath();
    ctx.moveTo(canvas.width * .75, 0);
    ctx.lineTo(canvas.width * .75, canvas.height);
    ctx.strokeStyle = '#ff0000';
    ctx.stroke();

    if (selectedShape !== null) {
        const selectedParameter = getSelectedParameter();

        if (selectedParameter !== null) {
            ctx.beginPath();

            let seconds = 0;
            selectedParameter[1].map((point, i) => {
                const x = ((seconds + parameterPanelSeconds / 2 - editorSeconds) / parameterPanelSeconds + 1) * canvas.width / 2;
                const y = canvas.height / 2 + point[1] * parameterPanelYScale;

                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }

                seconds += point[0] * timeStep;
            });

            ctx.lineWidth = 2;
            ctx.strokeStyle = '#ff9f00';
            ctx.stroke();

            seconds = 0;
            selectedParameter[1].map(point => {
                const x = ((seconds + parameterPanelSeconds / 2 - editorSeconds) / parameterPanelSeconds + 1) * canvas.width / 2;
                const y = canvas.height / 2 + point[1] * parameterPanelYScale;

                ctx.beginPath();
                ctx.arc(x, y, 5, 0, Math.PI * 2);

                ctx.fillStyle = selectedPoint === point ? '#00ffff' : '#ff00ff';
                ctx.fill();

                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.fillText(`${seconds.toFixed(1)},${point[1]}`, x, y - 10);

                seconds += point[0] * timeStep;
            });
        }

        const parameterNames = ['x', 'y', 'angle', 'scale x', 'scale y', 'context', 'trigger sound'];

        ctx.textAlign = 'left';
        ctx.fillStyle = '#00ff00';
        ctx.fillText(`parameter: ${selectedParameterIndex < 7 ? 'delta ' : ''}${parameterNames[selectedParameterIndex % 7]}`, canvas.width / 2 + 10, 20);
    }

    requestAnimationFrame(render);
};

////////////////////////////////////////////////////////////////////////
// Start

addEventListener('load', () => {
    editor = true;

    setupCanvas();

    canvas.oncontextmenu = e => e.preventDefault();

    startLevels([0]);
    render(0);
});
