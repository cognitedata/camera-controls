# camera-controls

A camera control for three.js, similar to THREE.OrbitControls yet supports smooth transitions, es6 import and FPV.

## Test

To test the controller then do:
 - `git clone`
 - `cd camera-controls`
 - `yarn`
 - `yarn run dev`
 - Open `camera-controls/examples/basic.html` on browser

## Usage

```javascript
import * as THREE from 'three';
import { CameraControls } from 'camera-controls';

CameraControls.install(THREE);

// snip ( init three scene... )
const clock = new THREE.Clock();
const camera = new THREE.PerspectiveCamera(60, width / height, 0.01, 100);
const cameraControls = new CameraControls(camera, renderer.domElement);

( function anim () {
	// snip
	const delta = clock.getDelta();
	const isControlsUpdated = cameraControls.update(delta);

	requestAnimationFrame(anim);

	if (isControlsUpdated) {
		renderer.render(scene, camera);
	}
} )();
```

## Constructor

`CameraControls(camera, domElement)`

- `camera` is a three.js perspective camera to be controlled.
- `domElement` is a HTML element for draggable area.

## Properties

- `.enabled`: Default is `true`. Whether or not the controls are enabled.
- `.minDistance`: Default is `0`. Minimum distance for dolly.
- `.maxDistance`: Default is `Infinity`. Maximum distance for dolly.
- `.minPolarAngle`: Default is `0`, in radians.
- `.maxPolarAngle`: Default is `Math.PI`, in radians.
- `.minAzimuthAngle`: Default is `-Infinity`, in radians.
- `.maxAzimuthAngle`: Default is `Infinity`, in radians.
- `.dampingFactor`: Default is `0.5`.
- `.draggingDampingFactor`: Default is `0.1`.
- `.minZoomDistance`: Default is `0.3`. Min zoom distance per zoom event.
- `.maxZoomDistance`: Default is `1.0`. Max zoom distance per zoom event.
- `.panSpeed`: Default is `1.0`. Speed of drag panning (only for touch).
- `.minPanDistance`: Default is `1.0`. Min distance to mvoe when panning.
- `.rotationSpeed`: Default is `0.005`. Speed to rotate in first-person mode.
- `.enableKeyboardNavigation`: Default is `true`. If keyboard navigation is enabled.
- `.minDistToTarget`: Default is `2.0`. Minimum distance to a target you can be (will push the target if closer).

## Methods

#### `rotate(rotX, rotY, enableTransition)`

Rotate azimuthal angle(theta) and polar angle(phi). `rotX` and `rotY` are in radian. `enableTransition` is in a boolean

#### `rotateTo(rotX, rotY, enableTransition)`

Rotate azimuthal angle(theta) and polar angle(phi) to a given point.

#### `dolly(distance, enableTransition, x = 0, y = 0)`

Dolly in/out camera position. `distance` is in a number. `enableTransition` is in a boolean.
`x` and `y` is the dolly direction in GL coordinates (-1, +1).

#### `dollyTo(distance, enableTransition, x = 0, y = 0)`

Dolly in/out camera position to given distance.
`x` and `y` is the dolly direction in GL coordinates (-1, +1).

#### `pan(x, y, enableTransition)`

Pan camera using current azimuthal angle.

#### `moveTo(x, y, z, enableTransition)`

Move `target` position to given point.

#### `getState()`

Get the current internal state.

#### `setCameraPosition(position, target, enableTransition = false)`

Set camera position to `position` and target to `target`.

#### `reset(enableTransition)`

Reset all rotation, zoom, position to default.

#### `update(delta)`

Update camera position and directions. This should be called in your tick loop and returns `true` if re-rendering is needed.
`delta` is delta time between previous update call.

#### `dispose()`

Dispose cameraControls instancem, remove all eventListeners.
