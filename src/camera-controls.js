let THREE;
let _v3;
let _xColumn;
let _yColumn;
const EPSILON = 0.001;
const STATE = {
	NONE        : - 1,
	ROTATE      :   0,
	DOLLY       :   1,
	PAN         :   2,
	TOUCH_ROTATE:   3,
	TOUCH_DOLLY :   4,
	TOUCH_PAN   :   5,
	ROTATE_FP   :   6, // rotate first person mode
	FP_NAVIGATE :   7  // first person navigate mode (WASD)
};

export default class CameraControls {

	static install( libs ) {

		THREE = libs.THREE;
		_v3 = new THREE.Vector3();
		_xColumn = new THREE.Vector3();
		_yColumn = new THREE.Vector3();

	}

	constructor( object, domElement ) {

		this.object = object;
		this.enabled = true;

		this.minDistance = 0;
		this.maxDistance = Infinity;
		this.minPolarAngle = 0; // radians
		this.maxPolarAngle = Math.PI; // radians
		this.minAzimuthAngle = - Infinity; // radians
		this.maxAzimuthAngle = Infinity; // radians
		this.dampingFactor = 0.05;
		this.draggingDampingFactor = 0.25;
		this.zoomSpeed = 1.0;
		this.panSpeed = 2.0;
		this.rotationSpeed = 0.005;
		this.enableKeyboardNavigation = true;

		this.domElement = domElement;

		// the location of focus, where the object orbits around
		this.target = new THREE.Vector3();
		this._targetEnd = new THREE.Vector3();

		// rotation
		this._spherical = new THREE.Spherical();
		this._spherical.setFromVector3( this.object.position );
		this._sphericalEnd = new THREE.Spherical().copy( this._spherical );

		// reset
		this._target0 = this.target.clone();
		this._position0 = this.object.position.clone();

		this._needsUpdate = true;
		this.update();

		if ( ! this.domElement ) {

			this.dispose = () => {};

		} else {

			const scope = this;
			const dragStart  = new THREE.Vector2();
			const dollyStart = new THREE.Vector2();
			let state = STATE.NONE;
			let elementRect;
			let savedDampingFactor;

			this.domElement.addEventListener( 'mousedown', onMouseDown );
			this.domElement.addEventListener( 'touchstart', onTouchStart );
			this.domElement.addEventListener( 'wheel', onMouseWheel );
			this.domElement.addEventListener( 'contextmenu', onContextMenu );
			document.addEventListener( 'keydown', onKeyDown, true );

			this.dispose = () => {

				scope.domElement.removeEventListener( 'mousedown', onMouseDown );
				scope.domElement.removeEventListener( 'touchstart', onTouchStart );
				scope.domElement.removeEventListener( 'wheel', onMouseWheel );
				scope.domElement.removeEventListener( 'contextmenu', onContextMenu );
				document.removeEventListener( 'keydown', onKeyDown );
				document.removeEventListener( 'mousemove', dragging );
				document.removeEventListener( 'touchmove', dragging );
				document.removeEventListener( 'mouseup', endDragging );
				document.removeEventListener( 'touchend', endDragging );

			};

			function onMouseDown( event ) {

				if ( ! scope.enabled ) return;

				event.preventDefault();

				const prevState = state;

				switch ( event.button ) {

					case THREE.MOUSE.LEFT:

						state = event.shiftKey ? STATE.ROTATE_FP : STATE.ROTATE;
						break;

					case THREE.MOUSE.MIDDLE:

						state = STATE.DOLLY;
						break;

					case THREE.MOUSE.RIGHT:

						state = STATE.PAN;
						break;

				}

				if ( prevState === STATE.NONE ) {

					startDragging( event );

				}

			}

			function onTouchStart( event ) {

				if ( ! scope.enabled ) return;

				event.preventDefault();

				const prevState = state;

				switch ( event.touches.length ) {

					case 1:	// one-fingered touch: rotate

						state = STATE.TOUCH_ROTATE;
						break;

					case 2:	// two-fingered touch: dolly

						state = STATE.TOUCH_DOLLY;
						break;

					case 3: // three-fingered touch: pan

						state = STATE.TOUCH_PAN;
						break;

				}

				if ( prevState === STATE.NONE ) {

					startDragging( event );

				}

			}


			function onMouseWheel( event ) {

				if ( ! scope.enabled ) return;

				event.preventDefault();

				const num = Math.min(7, Math.abs(event.deltaY));
				for (let i = 0; i < num; i++) {
					if ( event.deltaY < 0 ) {
						dollyIn();
					} else {
						dollyOut();
					}
				}

			}

			function onKeyDown( event ) {
				
				if ( ! scope.enabled || ! scope.enableKeyboardNavigation ) return;

				event.preventDefault();

				function keyboardPan(deltaX, deltaY) {
					const panSpeed = 20;
					const elementRect = scope.domElement.getBoundingClientRect();
					const offset = _v3.copy( scope.object.position ).sub( scope.target );
					// half of the fov is center to top of screen
					const targetDistance = offset.length() * Math.tan( ( scope.object.fov / 2 ) * Math.PI / 180 );
					const panX = ( scope.panSpeed * deltaX * panSpeed * targetDistance / elementRect.height );
					const panY = ( scope.panSpeed * deltaY * panSpeed * targetDistance / elementRect.height );
					scope.pan( panX, panY, true );
				}

				const fastMoving = event.shiftKey;
				const numDolly = fastMoving ? 25 : 5;

				switch (event.keyCode) {
					case 38: // UP
					case 87: // W
						state = STATE.FP_NAVIGATE;
						for (let i = 0; i < numDolly; i++) {
							dollyIn();
						}
						document.addEventListener('keyup', onKeyUp);
						break;
					
					case 40: // DOWN
					case 83: // S
						state = STATE.FP_NAVIGATE;
						for (let i = 0; i < numDolly; i++) {
							dollyOut();
						}
						document.addEventListener('keyup', onKeyUp);
						break;

					case 37: // LEFT
					case 65: // A
						state = STATE.FP_NAVIGATE;
						document.addEventListener('keyup', onKeyUp);
						keyboardPan(fastMoving ? -5 : -1, 0);
						break;

					case 39: // RIGHT
					case 68: // D
						state = STATE.FP_NAVIGATE;
						document.addEventListener('keyup', onKeyUp);
						keyboardPan(fastMoving ? 5 : 1, 0);
						break;
				}
			}

			function onKeyUp( event ) {
				state = STATE.NONE;
				document.removeEventListener('keyup', onKeyUp);
			}

			function onContextMenu( event ) {

				if ( ! scope.enabled ) return;

				event.preventDefault();

			}

			function startDragging( event ) {

				if ( ! scope.enabled ) return;

				event.preventDefault();

				const _event = !! event.touches ? event.touches[ 0 ] : event;
				const x = _event.clientX;
				const y = _event.clientY;

				elementRect = scope.domElement.getBoundingClientRect();
				dragStart.set( x, y );

				// if ( state === STATE.DOLLY ) {

				// 	dollyStart.set( x, y );

				// }

				if ( state === STATE.TOUCH_DOLLY ) {

					const dx = x - event.touches[ 1 ].pageX;
					const dy = y - event.touches[ 1 ].pageY;
					const distance = Math.sqrt( dx * dx + dy * dy );

					dollyStart.set( 0, distance );

				}

				savedDampingFactor = scope.dampingFactor;
				scope.dampingFactor = scope.draggingDampingFactor;

				document.addEventListener( 'mousemove', dragging, { passive: false } );
				document.addEventListener( 'touchmove', dragging, { passive: false } );
				document.addEventListener( 'mouseup', endDragging );
				document.addEventListener( 'touchend', endDragging );

			}

			function dragging( event ) {

				if ( ! scope.enabled ) return;

				event.preventDefault();

				const _event = !! event.touches ? event.touches[ 0 ] : event;
				const x = _event.clientX;
				const y = _event.clientY;

				const deltaX = dragStart.x - x;
				const deltaY = dragStart.y - y;

				dragStart.set( x, y );

				switch ( state ) {

					case STATE.ROTATE:
					case STATE.TOUCH_ROTATE:

						const rotX = 2 * Math.PI * deltaX / elementRect.width;
						const rotY = 2 * Math.PI * deltaY / elementRect.height;
						scope.rotate( rotX, rotY, true );
						break;

					case STATE.DOLLY:
						// not implemented
						break;

					case STATE.TOUCH_DOLLY:

						const dx = x - event.touches[ 1 ].pageX;
						const dy = y - event.touches[ 1 ].pageY;
						const distance = Math.sqrt( dx * dx + dy * dy );
						const dollyDelta = dollyStart.y - distance;

						if ( dollyDelta > 0 ) {

							dollyOut();

						} else if ( dollyDelta < 0 ) {

							dollyIn();

						}

						dollyStart.set( 0, distance );
						break;

					case STATE.PAN:
					case STATE.TOUCH_PAN:

						const offset = _v3.copy( scope.object.position ).sub( scope.target );
						// half of the fov is center to top of screen
						const targetDistance = offset.length() * Math.tan( ( scope.object.fov / 2 ) * Math.PI / 180 );
						const panX = ( scope.panSpeed * deltaX * targetDistance / elementRect.height );
						const panY = ( scope.panSpeed * deltaY * targetDistance / elementRect.height );
						scope.pan( panX, panY, true );
						break;

					case STATE.ROTATE_FP:
					  scope.rotatetFP(deltaX, deltaY);
						break;
				}

			}

			function endDragging() {

				if ( ! scope.enabled ) return;

				scope.dampingFactor = savedDampingFactor;
				state = STATE.NONE;

				document.removeEventListener( 'mousemove', dragging );
				document.removeEventListener( 'touchmove', dragging );
				document.removeEventListener( 'mouseup', endDragging );
				document.removeEventListener( 'touchend', endDragging );

			}

			function dollyIn() {

				const zoomScale = Math.pow( 0.98, scope.zoomSpeed );
				scope.dolly( scope._sphericalEnd.radius * zoomScale - scope._sphericalEnd.radius );
			}

			function dollyOut() {

				const zoomScale = Math.pow( 0.98, scope.zoomSpeed );
				scope.dolly( scope._sphericalEnd.radius / zoomScale - scope._sphericalEnd.radius );
			}


		}

	}

	// rotX in radian
	// rotY in radian
	rotate( rotX, rotY, enableTransition ) {

		this.rotateTo(
			this._sphericalEnd.theta + rotX,
			this._sphericalEnd.phi   + rotY,
			enableTransition
		);

	}

	// rotX in radian
	// rotY in radian
	rotateTo( rotX, rotY, enableTransition ) {

		const theta = Math.max( this.minAzimuthAngle, Math.min( this.maxAzimuthAngle, rotX ) );
		const phi   = Math.max( this.minPolarAngle,   Math.min( this.maxPolarAngle,   rotY ) );

		this._sphericalEnd.theta = theta;
		this._sphericalEnd.phi   = phi;
		this._sphericalEnd.makeSafe();

		if ( ! enableTransition ) {

			this._spherical.theta = this._sphericalEnd.theta;
			this._spherical.phi   = this._sphericalEnd.phi;

		}

		this._needsUpdate = true;
		this.update();

	}

	rotatetFP( deltaX, deltaY ) {
		const camera = this.object;
		camera.rotateY(deltaX * this.rotationSpeed);
		camera.rotateX(deltaY * this.rotationSpeed);

		const _lookAtTarget = camera.clone();

		_lookAtTarget.position.copy(camera.position);
		_lookAtTarget.rotation.copy(camera.rotation);
		_lookAtTarget.translateZ(-1);
		camera.lookAt(_lookAtTarget.position);
		
		const cameraDirection = camera.getWorldDirection();
		const targetOffset = new THREE.Vector3().subVectors(this.target, camera.position);
		const distToTarget = targetOffset.length();
		this.target.addVectors(camera.position, cameraDirection.multiplyScalar(distToTarget));
		this._targetEnd.copy(this.target);

		this._spherical.setFromVector3( new THREE.Vector3().subVectors(camera.position, this.target));
		this._sphericalEnd.copy(this._spherical);
	}

	dolly( distance, enableTransition ) {

		this.dollyTo( this._sphericalEnd.radius + distance, enableTransition );

	}

	dollyTo( distance, enableTransition ) {

		this._sphericalEnd.radius = THREE.Math.clamp(
			distance,
			this.minDistance,
			this.maxDistance
		);

		if ( ! enableTransition ) {

			this._spherical.radius = this._sphericalEnd.radius;

		}

		this._needsUpdate = true;
		this.update();

	}

	pan( x, y, enableTransition ) {

		this.object.updateMatrix();

		_xColumn.setFromMatrixColumn( this.object.matrix, 0 );
		_yColumn.setFromMatrixColumn( this.object.matrix, 1 );
		_xColumn.multiplyScalar(   x );
		_yColumn.multiplyScalar( - y );

		const offset = _v3.copy( _xColumn ).add( _yColumn );
		this._targetEnd.add( offset );

		if ( ! enableTransition ) {

			this.target.copy( this._targetEnd );

		}

		this._needsUpdate = true;
		this.update();

	}

	moveTo( x, y, z, enableTransition ) {

		this._targetEnd.set( x, y, z );

		if ( ! enableTransition ) {

			this.target.copy( this._targetEnd );

		}

		this._needsUpdate = true;

	}

	saveState() {

		this._target0.copy( this.target );
		this._position0.copy( this.object.position );

	}

	reset( enableTransition ) {

		this._targetEnd.copy( this._target0 );
		this._sphericalEnd.setFromVector3( this._position0 );
		this._sphericalEnd.theta = this._sphericalEnd.theta % ( 2 * Math.PI );
		this._spherical.theta    = this._spherical.theta    % ( 2 * Math.PI );

		if ( ! enableTransition ) {

			this.target.copy( this._targetEnd );
			this._spherical.copy( this._sphericalEnd );

		}

		this._needsUpdate = true;

	}

	update( delta ) {

		// const dampingFactor = this.dampingFactor * delta / 0.016;
		const dampingFactor = 1;
		const deltaTheta  = this._sphericalEnd.theta  - this._spherical.theta;
		const deltaPhi    = this._sphericalEnd.phi    - this._spherical.phi;
		const deltaRadius = this._sphericalEnd.radius - this._spherical.radius;
		const deltaTarget = new THREE.Vector3().subVectors( this._targetEnd, this.target );

		if (
			Math.abs( deltaTheta    ) > EPSILON ||
			Math.abs( deltaPhi      ) > EPSILON ||
			Math.abs( deltaRadius   ) > EPSILON ||
			Math.abs( deltaTarget.x ) > EPSILON ||
			Math.abs( deltaTarget.y ) > EPSILON ||
			Math.abs( deltaTarget.z ) > EPSILON
		) {

			this._spherical.set(
				this._spherical.radius + deltaRadius * dampingFactor,
				this._spherical.phi    + deltaPhi    * dampingFactor,
				this._spherical.theta  + deltaTheta  * dampingFactor
			);

			this.target.add( deltaTarget.multiplyScalar( dampingFactor ) );

			this._needsUpdate = true;

		} else {

			this._spherical.copy( this._sphericalEnd );
			this.target.copy( this._targetEnd );

		}

		this._spherical.makeSafe();
		this.object.position.setFromSpherical( this._spherical ).add( this.target );
		this.object.lookAt( this.target );

		const minTargetLength = 1;
		const offset = new THREE.Vector3().subVectors(this.target, this.object.position);
		if (offset.length() < minTargetLength) {
			this.target.copy( this.object.getWorldDirection().multiplyScalar(minTargetLength).add(this.object.position) );
			this._targetEnd.copy(this.target);
			this._spherical.setFromVector3( new THREE.Vector3().subVectors(this.object.position, this.target));
			this._sphericalEnd.copy(this._spherical);
		}

		const needsUpdate = this._needsUpdate;
		this._needsUpdate = false;

		return needsUpdate;

	}

}
