const Keyboard = require('game-keyboard');
const keyMap = require('game-keyboard/key_map').US;

let THREE;
const EPSILON = 0.001;
const STATE = {
  NONE: -1,
  ROTATE: 0,
  DOLLY: 1,
  PAN: 2,
  TOUCH_ROTATE: 3,
  TOUCH_DOLLY: 4,
  TOUCH_PAN: 5,
  ROTATE_FP: 6, // rotate first person mode
  FP_NAVIGATE: 7, // first person navigate mode (WASD)
};
const isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') !== -1;

export class CameraControls {
  static install(THREE_) {
    THREE = THREE_;
  }

  constructor(object, domElement) {
    this.object = object;
    this.domElement = domElement;

    this.enabled = true;
    this.minDistance = 0;
    this.maxDistance = Infinity;
    this.minPolarAngle = 0; // radians
    this.maxPolarAngle = Math.PI; // radians
    this.minAzimuthAngle = -Infinity; // radians
    this.maxAzimuthAngle = Infinity; // radians
    this.dampingFactor = 0.05;
    this.draggingDampingFactor = 0.1;
    this.zoomSpeed = 1.0;
    this.maxZoomDistance = null;
    this.panSpeed = 1.0;
    this.keyboardPanSpeed = 20;
    this.minPanSpeed = 1.0;
    this.rotationSpeed = 0.005;
    this.enableKeyboardNavigation = true;
    this.enableMinDistToTarget = true;
    this.minDistToTarget = 3;

    // the location of focus, where the object orbits around
    this.target = new THREE.Vector3();
    this.targetEnd = new THREE.Vector3();

    // rotation
    this.spherical = new THREE.Spherical();
    this.spherical.setFromVector3(this.object.position);
    this.sphericalEnd = new THREE.Spherical().copy(this.spherical);

    // state
    this.state = STATE.NONE;
    this.keyboard = new Keyboard(keyMap);

    // reset
    this.target0 = this.target.clone();
    this.position0 = this.object.position.clone();

    // cached variables
    this.mouse = new THREE.Vector2();
    this.plane = new THREE.Plane();
    this.line3 = new THREE.Line3();
    this.v3 = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();
    this.xColumn = new THREE.Vector3();
    this.yColumn = new THREE.Vector3();
    this.dragStart = new THREE.Vector2();
    this.dollyStart = new THREE.Vector2();

    // use this
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onMouseWheel = this.onMouseWheel.bind(this);
    this.onContextMenu = this.onContextMenu.bind(this);
    this.dragging = this.dragging.bind(this);
    this.startDragging = this.startDragging.bind(this);
    this.endDragging = this.endDragging.bind(this);

    this.needsUpdate = true;
    this.update();

    if (!this.domElement) {
      this.dispose = () => {};
    } else {
      this.domElement.addEventListener('mousedown', this.onMouseDown);
      this.domElement.addEventListener('touchstart', this.onTouchStart);
      this.domElement.addEventListener('wheel', this.onMouseWheel);
      this.domElement.addEventListener('DOMMouseScroll', this.onMouseWheel);
      this.domElement.addEventListener('contextmenu', this.onContextMenu);

      this.dispose = () => {
        this.domElement.removeEventListener('mousedown', this.onMouseDown);
        this.domElement.removeEventListener('touchstart', this.onTouchStart);
        this.domElement.removeEventListener('wheel', this.onMouseWheel);
        this.domElement.removeEventListener(
          'DOMMouseScroll',
          this.onMouseWheel
        );
        this.domElement.removeEventListener('contextmenu', this.onContextMenu);
        document.removeEventListener('mousemove', this.dragging);
        document.removeEventListener('touchmove', this.dragging);
        document.removeEventListener('mouseup', this.endDragging);
        document.removeEventListener('touchend', this.endDragging);
      };
    }
  }

  onMouseDown(event) {
    if (!this.enabled) return;

    event.preventDefault();

    const prevState = this.state;

    switch (event.button) {
      case THREE.MOUSE.LEFT: {
        const ctrl = this.keyboard.isPressed('ctrl');
        const shift = this.keyboard.isPressed('shift');
        this.state = shift || ctrl ? STATE.ROTATE_FP : STATE.ROTATE;
        break;
      }

      case THREE.MOUSE.MIDDLE:
        this.state = STATE.DOLLY;
        break;

      case THREE.MOUSE.RIGHT:
        this.state = STATE.PAN;
        break;

      default:
        break;
    }

    if (prevState === STATE.NONE) {
      this.startDragging(event);
    }
  }

  onTouchStart(event) {
    if (!this.enabled) return;

    event.preventDefault();

    const prevState = this.state;

    switch (event.touches.length) {
      case 1: // one-fingered touch: rotate
        this.state = STATE.TOUCH_ROTATE;
        break;

      case 2: // two-fingered touch: dolly
        this.state = STATE.TOUCH_DOLLY;
        break;

      case 3: // three-fingered touch: pan
        this.state = STATE.TOUCH_PAN;
        break;

      default:
        break;
    }

    if (prevState === STATE.NONE) {
      this.startDragging(event);
    }
  }

  onMouseWheel(event) {
    if (!this.enabled) return;

    event.preventDefault();

    const x = (event.clientX / this.domElement.clientWidth) * 2 - 1;
    const y = -(event.clientY / this.domElement.clientHeight) * 2 + 1;

    let delta = 0;
    if (event.wheelDelta) {
      // WebKit / Opera / Explorer 9
      delta = -event.wheelDelta / 40;
    } else if (event.detail) {
      // Firefox
      delta = event.detail;
    } else if (event.deltaY) {
      // Firefox / Explorer + event target is SVG.
      const factor = isFirefox ? 1 : 40;
      delta = event.deltaY / factor;
    }

    if (delta < 0) {
      this.dollyIn(x, y, Math.abs(delta));
    } else {
      this.dollyOut(x, y, Math.abs(delta));
    }
  }

  checkKeyboardEvents() {
    if (!this.enabled || !this.enableKeyboardNavigation) return;
    const { keyboard } = this;
    const shift = keyboard.isPressed('shift');

    const keyboardPan = (deltaX, deltaY) => {
      const elementRect = this.domElement.getBoundingClientRect();
      const offset = this.v3.copy(this.object.position).sub(this.target);
      // half of the fov is center to top of screen
      const targetDistance =
        offset.length() * Math.tan(((this.object.fov / 2) * Math.PI) / 180);
      const panX =
        (this.panSpeed * deltaX * this.keyboardPanSpeed * targetDistance) /
        elementRect.height;
      const panY =
        (this.panSpeed * deltaY * this.keyboardPanSpeed * targetDistance) /
        elementRect.height;
      this.pan(panX, panY, true);
    };

    const fastMoving = shift;
    const distanceUnit = fastMoving ? 2 : 0.5;

    let change = false;
    if (keyboard.isPressed('w')) {
      change = true;
      this.dollyIn(0, 0, distanceUnit);
    }
    if (keyboard.isPressed('s')) {
      change = true;
      this.dollyOut(0, 0, distanceUnit);
    }
    if (keyboard.isPressed('a')) {
      change = true;
      keyboardPan(fastMoving ? -5 : -1, 0);
    }
    if (keyboard.isPressed('d')) {
      change = true;
      keyboardPan(fastMoving ? 5 : 1, 0);
    }

    const rotationSpeed = fastMoving ? 10 : 5;
    if (keyboard.isPressed('left')) {
      change = true;
      this.rotatetFP(rotationSpeed, 0, false);
    }
    if (keyboard.isPressed('up')) {
      change = true;
      this.rotatetFP(0, rotationSpeed * 0.5, false);
    }
    if (keyboard.isPressed('down')) {
      change = true;
      this.rotatetFP(0, -rotationSpeed * 0.5, false);
    }
    if (keyboard.isPressed('right')) {
      change = true;
      this.rotatetFP(-rotationSpeed, 0, false);
    }

    if (change) {
      this.state = STATE.FP_NAVIGATE;
      this.needsUpdate = true;
    } else if (this.state === STATE.FP_NAVIGATE) {
      this.state = STATE.NONE;
    }
  }

  onContextMenu(event) {
    if (!this.enabled) return;
    event.preventDefault();
  }

  startDragging(e) {
    if (!this.enabled) return;

    e.preventDefault();

    const event = e.touches ? e.touches[0] : e;
    const x = event.clientX;
    const y = event.clientY;

    this.dragStart.set(x, y);

    if (this.state === STATE.TOUCH_DOLLY) {
      const dx = x - e.touches[1].pageX;
      const dy = y - e.touches[1].pageY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      this.dollyStart.set(0, distance);
    }

    this.dampingFactor = this.draggingDampingFactor;

    document.addEventListener('mousemove', this.dragging, {
      passive: false,
    });
    document.addEventListener('touchmove', this.dragging, {
      passive: false,
    });
    document.addEventListener('mouseup', this.endDragging);
    document.addEventListener('touchend', this.endDragging);
  }

  dragging(e) {
    if (!this.enabled) return;

    e.preventDefault();

    const event = e.touches ? e.touches[0] : e;
    const x = event.clientX;
    const y = event.clientY;

    const deltaX = this.dragStart.x - x;
    const deltaY = this.dragStart.y - y;

    this.dragStart.set(x, y);

    const elementRect = this.domElement.getBoundingClientRect();

    switch (this.state) {
      case STATE.ROTATE:
      case STATE.TOUCH_ROTATE: {
        const rotX = (2 * Math.PI * deltaX) / elementRect.width;
        const rotY = (2 * Math.PI * deltaY) / elementRect.height;
        this.rotate(rotX, rotY, true);
        break;
      }

      case STATE.DOLLY:
        // not implemented
        break;

      case STATE.TOUCH_DOLLY: {
        const dx = x - e.touches[1].pageX;
        const dy = y - e.touches[1].pageY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const dollyDelta = this.dollyStart.y - distance;

        const centerX = (x + e.touches[1].pageX) / 2;
        const centerY = (y + e.touches[1].pageY) / 2;
        const glX = (centerX / this.domElement.clientWidth) * 2 - 1;
        const glY = -(centerY / this.domElement.clientHeight) * 2 + 1;

        if (dollyDelta > 0) {
          this.dollyOut(glX, glY);
        } else if (dollyDelta < 0) {
          this.dollyIn(glX, glY);
        }

        this.dollyStart.set(0, distance);
        break;
      }

      case STATE.PAN:
      case STATE.TOUCH_PAN: {
        const offset = this.v3.copy(this.object.position).sub(this.target);
        // half of the fov is center to top of screen
        const targetDistance =
          offset.length() * Math.tan(((this.object.fov / 2) * Math.PI) / 180);

        let panX =
          (this.panSpeed * deltaX * targetDistance) / elementRect.height;
        let panY =
          (this.panSpeed * deltaY * targetDistance) / elementRect.height;
        panX = THREE.Math.clamp(panX, -this.minPanSpeed, this.minPanSpeed);
        panY = THREE.Math.clamp(panY, -this.minPanSpeed, this.minPanSpeed);
        this.pan(panX, panY, true);
        break;
      }

      case STATE.ROTATE_FP: {
        this.rotatetFP(deltaX, deltaY);
        break;
      }

      default:
        break;
    }
  }

  endDragging() {
    if (!this.enabled) return;

    this.dampingFactor = this.dampingFactor;
    this.state = STATE.NONE;

    document.removeEventListener('mousemove', this.dragging);
    document.removeEventListener('touchmove', this.dragging);
    document.removeEventListener('mouseup', this.endDragging);
    document.removeEventListener('touchend', this.endDragging);
  }

  // x, y is coordinate to zoom to. It is in GL coordinates (-1, +1)
  dollyIn(x = 0, y = 0, distanceUnits = 1) {
    this.dolly(this.getZoomDistance(true, true, distanceUnits), true, x, y);
  }

  dollyOut(x = 0, y = 0, distanceUnits = 1) {
    this.dolly(this.getZoomDistance(false, true, distanceUnits), true, x, y);
  }

  // rotX in radian
  // rotY in radian
  rotate(rotX, rotY, enableTransition) {
    this.rotateTo(
      this.sphericalEnd.theta + rotX,
      this.sphericalEnd.phi + rotY,
      enableTransition
    );
  }

  // rotX in radian
  // rotY in radian
  rotateTo(rotX, rotY, enableTransition) {
    const theta = Math.max(
      this.minAzimuthAngle,
      Math.min(this.maxAzimuthAngle, rotX)
    );
    const phi = Math.max(
      this.minPolarAngle,
      Math.min(this.maxPolarAngle, rotY)
    );

    this.sphericalEnd.theta = theta;
    this.sphericalEnd.phi = phi;
    this.sphericalEnd.radius = this.spherical.radius;
    this.sphericalEnd.makeSafe();

    this.targetEnd.copy(this.target);

    if (!enableTransition) {
      this.spherical.theta = this.sphericalEnd.theta;
      this.spherical.phi = this.sphericalEnd.phi;
    }

    this.needsUpdate = true;
  }

  rotatetFP(deltaX, deltaY, forceUpdate = true) {
    const camera = this.object;
    camera.rotateY(deltaX * this.rotationSpeed);
    camera.rotateX(deltaY * this.rotationSpeed);

    const lookAtTarget = camera.clone();

    lookAtTarget.position.copy(camera.position);
    lookAtTarget.rotation.copy(camera.rotation);
    lookAtTarget.translateZ(-1);
    camera.lookAt(lookAtTarget.position);

    const cameraDirection = camera.getWorldDirection();
    this.v3.subVectors(this.target, camera.position);
    const distToTarget = this.v3.length();
    this.target.addVectors(
      camera.position,
      cameraDirection.multiplyScalar(distToTarget)
    );
    this.targetEnd.copy(this.target);

    this.spherical.setFromVector3(
      this.v3.subVectors(camera.position, this.target)
    );
    this.sphericalEnd.copy(this.spherical);

    this.needsUpdate = true;
    if (forceUpdate) {
      this.update();
    }
  }

  getZoomDistance(zoomIn, enableTransition = true, distanceUnits) {
    const zoomScale = 0.97 ** (this.zoomSpeed * distanceUnits);
    const minDistance = this.minDistToTarget / zoomScale - this.minDistToTarget;
    const camera = this.object;
    const radius = camera.position.distanceTo(this.target);
    let distance;
    if (zoomIn) {
      distance = radius * zoomScale - radius;
      distance = Math.min(-minDistance, distance);
    } else {
      distance = radius / zoomScale - radius;
      distance = Math.max(minDistance, distance);
    }
    if (this.maxZoomDistance !== null) {
      distance = THREE.Math.clamp(
        distance,
        -this.maxZoomDistance,
        this.maxZoomDistance
      );
    }
    return enableTransition ? (distance * 1) / this.dampingFactor : distance;
  }

  dolly(distance, enableTransition, x, y) {
    const radius = this.object.position.distanceTo(this.target);
    this.dollyTo(radius + distance, enableTransition, x, y);
  }

  dollyTo(distance, enableTransition, x, y) {
    const newDistanceToTarget = THREE.Math.clamp(
      distance,
      this.minDistance,
      this.maxDistance
    );
    const camera = this.object;
    const radius = camera.position.distanceTo(this.target);
    const cameraMoveDistance = radius - newDistanceToTarget;

    this.mouse.set(x, y);
    this.raycaster.setFromCamera(this.mouse, camera);

    const cameraOffset = this.raycaster.ray.direction
      .clone()
      .multiplyScalar(cameraMoveDistance);
    const newCameraPosition = camera.position.clone().add(cameraOffset);

    const cameraNormal = camera.getWorldDirection();
    const targetPointPlane = this.plane;
    targetPointPlane.setFromNormalAndCoplanarPoint(cameraNormal, this.target);
    const projectLine = this.line3;
    const lineLength = -targetPointPlane.distanceToPoint(newCameraPosition);
    projectLine.set(
      newCameraPosition,
      newCameraPosition
        .clone()
        .add(cameraNormal.clone().multiplyScalar(lineLength * 2))
    );
    const intersect = targetPointPlane.intersectLine(projectLine);
    this.targetEnd.copy(intersect);

    this.sphericalEnd.copy(this.spherical);
    this.sphericalEnd.radius = newDistanceToTarget;

    if (!enableTransition) {
      this.spherical.radius = this.sphericalEnd.radius;
      this.update();
    }

    this.needsUpdate = true;
  }

  pan(x, y, enableTransition) {
    this.object.updateMatrix();

    this.xColumn.setFromMatrixColumn(this.object.matrix, 0);
    this.yColumn.setFromMatrixColumn(this.object.matrix, 1);
    this.xColumn.multiplyScalar(x);
    this.yColumn.multiplyScalar(-y);

    const offset = this.v3.copy(this.xColumn).add(this.yColumn);
    this.targetEnd.add(offset);

    if (!enableTransition) {
      this.target.copy(this.targetEnd);
    }

    this.needsUpdate = true;
  }

  moveTo(x, y, z, enableTransition) {
    this.targetEnd.set(x, y, z);

    if (!enableTransition) {
      this.target.copy(this.targetEnd);
    }

    this.needsUpdate = true;
  }

  getState() {
    return this.state;
  }

  reset(enableTransition) {
    this.targetEnd.copy(this.target0);
    this.sphericalEnd.setFromVector3(this.position0);
    this.sphericalEnd.theta = this.sphericalEnd.theta % (2 * Math.PI);
    this.spherical.theta = this.spherical.theta % (2 * Math.PI);

    if (!enableTransition) {
      this.target.copy(this.targetEnd);
      this.spherical.copy(this.sphericalEnd);
    }

    this.needsUpdate = true;
  }

  setCameraPosition(position, target) {
    this.target0.copy(target);
    this.position0.copy(position.clone().sub(target));
    this.reset();
  }

  update(delta) {
    let dampingFactor = 1;
    if (delta != null) {
      dampingFactor = (this.dampingFactor * delta) / 0.016;
    }
    const deltaTheta = this.sphericalEnd.theta - this.spherical.theta;
    const deltaPhi = this.sphericalEnd.phi - this.spherical.phi;
    const deltaRadius = this.sphericalEnd.radius - this.spherical.radius;
    const deltaTarget = new THREE.Vector3().subVectors(
      this.targetEnd,
      this.target
    );

    if (
      Math.abs(deltaTheta) > EPSILON ||
      Math.abs(deltaPhi) > EPSILON ||
      Math.abs(deltaRadius) > EPSILON ||
      Math.abs(deltaTarget.x) > EPSILON ||
      Math.abs(deltaTarget.y) > EPSILON ||
      Math.abs(deltaTarget.z) > EPSILON
    ) {
      this.spherical.set(
        this.spherical.radius + deltaRadius * dampingFactor,
        this.spherical.phi + deltaPhi * dampingFactor,
        this.spherical.theta + deltaTheta * dampingFactor
      );

      this.target.add(deltaTarget.multiplyScalar(dampingFactor));

      this.needsUpdate = true;
    } else {
      this.spherical.copy(this.sphericalEnd);
      this.target.copy(this.targetEnd);
    }

    this.spherical.makeSafe();
    this.object.position.setFromSpherical(this.spherical).add(this.target);
    this.object.lookAt(this.target);

    if (this.enableMinDistToTarget) {
      this.v3.subVectors(this.target, this.object.position);
      if (this.v3.lengthSq() < this.minDistToTarget * this.minDistToTarget) {
        this.target.copy(
          this.object
            .getWorldDirection()
            .multiplyScalar(this.minDistToTarget)
            .add(this.object.position)
        );
        this.targetEnd.copy(this.target);
        this.spherical.setFromVector3(
          this.v3.subVectors(this.object.position, this.target)
        );
        this.sphericalEnd.copy(this.spherical);
      }
    }

    this.checkKeyboardEvents();

    const { needsUpdate } = this;
    this.needsUpdate = false;

    return needsUpdate;
  }
}
