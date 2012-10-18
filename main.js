/* Copyright:		© 2012 by Vitaly Gordon (rocket.mind@gmail.com)
 * Licensed under:	MIT
 */

Life = _.extends (Viewport, {
	init: function () {
		_.extend (this, {
			/* shaders */
			initialSetupShader: this.shaderProgram ({
				vertex: 'cell-vs',
				fragment: 'cell-initial-setup-fs',
				attributes: ['position'],
				uniforms: ['seed']
			}),
			iterationShader: this.shaderProgram ({
				vertex: 'cell-vs-pixeloffset',
				fragment: 'cell-iteration-fs',
				attributes: ['position'],
				uniforms: ['previousStep', 'screenSpace', 'pixelOffset']
			}),
			parametricBrushShader: this.shaderProgram ({
				vertex: 'cell-vs-pixeloffset',
				fragment: 'cell-brush-fs',
				attributes: ['position'],
				uniforms: ['cells', 'brushPosition1', 'brushPosition2', 'brushSize', 'seed',
					'pixelSpace', 'screenSpace', 'pixelOffset', 'noise', 'fill', 'animate']
			}),
			patternBrushShader: this.shaderProgram ({
				vertex: 'cell-vs-pixeloffset',
				fragment: 'cell-bake-brush-fs',
				attributes: ['position'],
				uniforms: ['brush', 'cells', 'origin', 'scale', 'color', 'screenSpace', 'pixelOffset', 'animate']
			}),
			copyBrushShader: this.shaderProgram ({
				vertex: 'cell-vs',
				fragment: 'cell-copy-brush-fs',
				attributes: ['position'],
				uniforms: ['source', 'origin', 'scale']
			}),
			drawCellsShader: this.shaderProgram ({
				vertex: 'simple-vs',
				fragment: 'draw-cells-fs',
				attributes: ['position'],
				uniforms: ['cells', 'transform']
			}),
			brushCursorShader: this.shaderProgram ({
				vertex: 'simple-vs',
				fragment: 'brush-selection-cursor-fs',
				attributes: ['position'],
				uniforms: ['color', 'transform']
			}),
			/* square mesh */
			square: this.vertexBuffer ({
				type: this.gl.TRIANGLE_STRIP,
				vertices: [
			         1.0,  1.0,  0.0,
			        -1.0,  1.0,  0.0,
			         1.0, -1.0,  0.0,
			        -1.0, -1.0,  0.0
		        ]
			}),
			/* buffers */
			cellBuffer: null, 												// current
			cellBuffer1: this.renderTexture ({ width: 512, height: 512 }),	// back
			cellBuffer2: this.renderTexture ({ width: 512, height: 512 }),	// front
			brushBuffer: this.renderTexture ({ width: 16, height: 16 }),	// clone stamp
			/* transform matrices */
			transform: new Transform (),
			screenTransform: new Transform (),
			/* changeable parameters */
			scrollSpeed: 2.0,
			brushSize: 16.0,
			patternBrushScale: 1.0,
			paused: false,
			resetWith: 'noise',
			/* other stuff */
			firstFrame: true
		})
		this.cellBuffer = this.cellBuffer1
		this.fillWithRandomNoise ()
		this.initUserInput ()
		this.initGUI ()
	},
	initUserInput: function () {
		$(this.canvas).mousewheel ($.proxy (this.onZoom, this))
		$(this.canvas).mousedown ($.proxy (function (e) {
			if (!e.button) {
				if (!this.isCloning) {
					this.onPaintStart (e)
				}
			} else {
				this.onDragStart (e)
			}
		}, this))
		$(this.canvas).bind ('contextmenu', function (e) {
			e.preventDefault ()
		})
		$(this.canvas).mousemove ($.proxy (function (e) {
			this.cloneStampPosition = this.eventPoint (e)
		}, this))
		$(window).keydown ($.proxy (function (e) {
			switch (e.keyCode) {
				case 18: /* alt */
					if (!this.isPainting) {
						this.onCloneStart (e);
					}
					break;
				case 82: /* r */ this.setBrushType ('round'); break;
				case 78: /* n */ this.setBrushType ('noise'); break;
				case 32: /* space */ this.paused = !this.paused; break;
				case 27: /* esc */ this.reset (this.resetWith); break;
			}
		}, this))
		$(window).resize ($.proxy (function () {
			var container = $('.viewport-container')
			var width = container.width (),
				height = container.height ()
			if (width >= this.cellBuffer.width && height >= this.cellBuffer.height) {
				this.resize (this.cellBuffer.width, this.cellBuffer.height)
			} else {
				this.resize (width, height)
			}
		}, this)).resize ()
	},
	initGUI: function () {
		this
			.slider ('.controls .width', { min: 9, max: 13, value: 9 }, function (value) {
				this.resizeBuffers (Math.pow (2, value), this.cellBuffer.height)
			})
			.slider ('.controls .height', { min: 9, max: 13, value: 9 }, function (value) {
				this.resizeBuffers (this.cellBuffer.width, Math.pow (2, value))
			})
			.slider ('.controls .scroll-speed', { min: 0, max: 6, value: 1 }, function (value) {
				this.scrollSpeed = value*2
			})
			.slider ('.controls .brush-scale', { min: 0, max: 10, value: 4, step: 0.1 }, function (value, slider) {
				this.brushSize = Math.pow (2, value)
			})
			.slider ('.controls .pattern-brush-scale', { min: 0, max: 6, value: 0, step: 0.1 }, function (value, slider) {
				this.patternBrushScale = Math.pow (2, value)
			})
		$('.reset')
			.click ($.proxy (function (e) {
				this.reset (this.resetWith = ($(e.target).attr ('data-reset-with') || this.resetWith))
			}, this))
		$('.brush-type .btn')
			.click ($.proxy (function (e) {
				this.setBrushType ($(e.target).attr ('data-brush-type'))
			}, this))
		$('.btn-pause')
			.click ($.proxy (function (e) {
				this.paused = !this.paused
			}, this))
		$('.btn')
			.tooltip ({
				placement: 'bottom',
				trigger: 'hover'
			})
		$('.brush-type .pattern').tooltip ('destroy').tooltip ({
			placement: 'bottom',
			trigger: 'click'
		})
		$('.btn-info').click (function () {
			$('.modal.info').modal ('show')
		})
	},
	slider: function (selector, cfg, handler) {
		var el = $(selector)
		el.slider (cfg).bind ('slide', $.proxy (function (e, ui) {
			handler.call (this, ui.value, el)
			el.find ('.ui-slider-handle').blur () /* do not want focus */
		}, this))
		return this
	},
	setBrushType: function (type) {
		this.brushType = type
		$('.brush-type .btn').removeClass ('active')
		$('.brush-type .' + type).addClass ('active')
		$('.brush-settings').attr ('class', 'brush-settings ' + type)
		if (type != 'pattern') {
			$('.brush-type .pattern').tooltip ('hide')
		}
	},
	resizeBuffers: function (w, h) {
		this.cellBuffer1.resize (w, h)
		this.cellBuffer2.resize (w, h)
		$(window).resize ()
		this.reset ('noise')
	},
	reset: function (type) {
		if (type == 'noise') {
			this.fillWithRandomNoise ()
		} else {
			this.fillWithNothing ()
		}
		this.updateTransform (new Transform ())
	},
	eventPoint: function (e) {
		var offset = $(this.canvas).offset ()
		return [
			(e.clientX - offset.left) / (this.viewportWidth * 0.5) - 1.0,
			(offset.top - e.clientY) / (this.viewportHeight * 0.5) + 1.0, 0.0]
	},
	onDragStart: function (e) {
		this.isDragging = true
		var origin = this.transform.applyInverse (this.eventPoint (e))
		$(window).mousemove ($.proxy (function (e) {
			var point = this.transform.applyInverse (this.eventPoint (e))
			this.updateTransform (this.transform.translate ([point[0] - origin[0], point[1] - origin[1], 0.0]))
		}, this))
		$(window).mouseup ($.proxy (function () {
			this.isDragging = false
			$(window).unbind ('mouseup')
			$(window).unbind ('mousemove')
		}, this))
	},
	onZoom: function (e) {
		var zoom = Math.pow (1.03, e.originalEvent.wheelDelta ?
			(e.originalEvent.wheelDelta / (navigator.platform == 'MacIntel' ? 360.0 : 36.0)) : -e.originalEvent.detail)
		var origin = this.transform.applyInverse (this.eventPoint (e))
		this.updateTransform (this.transform.multiply (new Transform ()
			.translate (origin)
			.scale ([zoom, zoom, 1.0])
			.translate ([-origin[0], -origin[1], 0.0])))
	},
	getZoom: function () {
		return vec3.length (vec3.subtract (
				this.transform.apply ([0, 0, 0]),
				this.transform.apply ([1, 0, 0])))
	},
	onCloneStart: function (e) {
		$('.brush-type .pattern').tooltip ('hide')
		this.setBrushType ('pattern')
		this.isCloning = true
		var zoom = Math.max (1, this.getZoom ())
		var size = Math.min (this.viewportWidth / zoom, this.viewportHeight / zoom)
		var npot = Math.max (8, Math.pow (2, Math.floor (Math.log2 (size)) - 1))
		this.brushBuffer.resize (npot, npot)
		$(window).mousemove ($.proxy (function (e) {
			this.cloneStampPosition = this.eventPoint (e)
		}, this))
		$(window).keyup ($.proxy (function () {
			this.isCloning = false
			$(window).unbind ('keyup')
			$(window).unbind ('mousemove')
		}, this))
	},
	onPaintStart: function (e) {
		this.isPainting = true
		this.paintFrom = this.paintTo = this.eventPoint (e)
		this.eraseMode = e.shiftKey
		$(window).mousemove ($.proxy (function (e) {
			this.paintTo = this.eventPoint (e)
			this.eraseMode = e.shiftKey
		}, this))
		$(window).mouseup ($.proxy (function () {
			this.isPainting = false
			$(window).unbind ('mouseup')
			$(window).unbind ('mousemove')
		}, this))
	},
	fillWithRandomNoise: function () {
		this.gl.clearColor (0.0, 0.0, 0.0, 1.0)
		this.cellBuffer.draw (function () {
			this.initialSetupShader.use ()
			this.initialSetupShader.attributes.position.bindBuffer (this.square)
			this.initialSetupShader.uniforms.seed.set2f (Math.random (), Math.random ())
			this.square.draw ()
		}, this)
		this.firstFrame = true
	},
	fillWithNothing: function () {
		this.gl.clearColor (0.0, 0.0, 0.0, 1.0)
		this.cellBuffer.draw (function () {
			this.gl.clear (this.gl.COLOR_BUFFER_BIT)
		}, this)
	},
	springDynamics: function () {
		var zoom = this.getZoom ()
		if (!this.isDragging) {
			if (zoom > 0.99) {
				var center = this.transform.apply ([0, 0, 0])
				var springForce = [
					(Math.max (0, Math.abs(center[0]) - (zoom - 1))) / zoom,
					(Math.max (0, Math.abs(center[1]) - (zoom - 1))) / zoom]
				this.updateTransform (this.transform.translate ([
					(Math.pow (1.2, springForce[0]) - 1.0) * (center[0] > 0 ? -1 : 1),
					(Math.pow (1.2, springForce[1]) - 1.0) * (center[1] > 0 ? -1 : 1), 0.0]))
			} else {
				this.updateTransform (this.transform.translate (this.transform.applyInverse ([0, 0, 0])))
			}
		}
		if (zoom < 1.0) {
			var springForce = Math.pow (1.2, 1.0 - zoom)
			this.updateTransform (this.transform.scale ([springForce, springForce, 1.0]))
		}
	},
	updateTransform: function (newTransform) {
		var viewportTransform = new Transform ()
		var aspect = this.viewportWidth / this.viewportHeight
		var bufferAspect = this.cellBuffer.width / this.cellBuffer.height
		if (this.cellBuffer.width < this.viewportWidth && this.cellBuffer.height < this.viewportHeight) {
			viewportTransform = viewportTransform.scale ([
				this.cellBuffer.width / this.viewportWidth,
				this.cellBuffer.height / this.viewportHeight, 1.0])
		} else {
			viewportTransform = viewportTransform.scale (this.cellBuffer.width > this.cellBuffer.height
				? [1.0, aspect / bufferAspect, 1.0]
				: [bufferAspect / aspect, 1.0, 1.0])
		}
		this.transform = newTransform || this.transform
		this.screenTransform = this.transform.multiply (viewportTransform)
	},
	beforeDraw: function () {
		if (!this.paused) {
			if (this.isPainting) {
				this.paint (true)
			} else {
				this.iterate ()
			}
		} else if (this.isPainting) {
			this.paint (false)
		}
		if (this.isCloning) {
			this.updateBrushBuffer ()
		}
		this.springDynamics ()
	},
	renderCells: function (callback) {
		/* backbuffering */
		var targetBuffer = (this.cellBuffer == this.cellBuffer1 ? this.cellBuffer2 : this.cellBuffer1)
		targetBuffer.draw (callback, this)
		this.cellBuffer = targetBuffer
		this.firstFrame = false
	},
	iterate: function () {
		this.renderCells (function () {
			this.iterationShader.use ()
			this.iterationShader.attributes.position.bindBuffer (this.square)
			this.iterationShader.uniforms.previousStep.bindTexture (this.cellBuffer, 0)
			this.iterationShader.uniforms.screenSpace.set2f (1.0 / this.cellBuffer.width, 1.0 / this.cellBuffer.height)
			this.iterationShader.uniforms.pixelOffset.set2f (
				0.0 / this.cellBuffer.width,
				-(0.5 + this.scrollSpeed * !this.firstFrame) / this.cellBuffer.height)
		    this.square.draw ()
		})
	},
	paint: function (animate) {
		if (this.brushType == 'pattern' && this.brushBufferReady) {
			this.paintBrushBuffer (animate)
		} else {
			this.paintParametricBrush (animate)
		}
		this.paintFrom = this.paintTo
	},
	paintBrushBuffer: function (animate) {
		this.renderCells (function () {
			this.patternBrushShader.use ()
			this.patternBrushShader.attributes.position.bindBuffer (this.square)
			this.patternBrushShader.uniforms.cells.bindTexture (this.cellBuffer, 0)
			this.patternBrushShader.uniforms.brush.bindTexture (this.brushBuffer, 1)
			this.patternBrushShader.uniforms.pixelOffset.set2f (0.0,
				animate ? (-(0.5 + this.scrollSpeed * !this.firstFrame) / this.cellBuffer.height) : 0.0)
			this.patternBrushShader.uniforms.screenSpace.set2f (1.0 / this.cellBuffer.width, 1.0 / this.cellBuffer.height)
			this.patternBrushShader.uniforms.color.set3fv (this.eraseMode ? vec3.create ([0,0,0]) : vec3.create ([1,1,1]))
			this.patternBrushShader.uniforms.origin.set2fv (this.screenTransform.applyInverse (this.paintTo))
			this.patternBrushShader.uniforms.animate.set1i (animate ? 1 : 0)
			this.patternBrushShader.uniforms.scale.set2f (
				(this.brushBuffer.width / this.cellBuffer.width) * this.patternBrushScale,
				(this.brushBuffer.height / this.cellBuffer.height) * this.patternBrushScale)
			this.square.draw ()
		})
	},
	paintParametricBrush: function (animate) {
		this.renderCells (function () {
			var pixelSpace = new Transform ()
				.scale ([this.viewportWidth, this.viewportHeight, 1.0])
				.multiply (this.screenTransform)
			var texelSize =
				pixelSpace.apply ([0,0,0])[0] -
				pixelSpace.apply ([-1.0 / this.cellBuffer.width, 0, 0])[0]
			this.parametricBrushShader.use ()
			this.parametricBrushShader.attributes.position.bindBuffer (this.square)
			this.parametricBrushShader.uniforms.cells.bindTexture (this.cellBuffer, 0)
			this.parametricBrushShader.uniforms.brushPosition1.set2fv (this.screenTransform.applyInverse (this.paintFrom))
			this.parametricBrushShader.uniforms.brushPosition2.set2fv (this.screenTransform.applyInverse (this.paintTo))
			this.parametricBrushShader.uniforms.pixelSpace.setMatrix (pixelSpace)
			this.parametricBrushShader.uniforms.pixelOffset.set2f (0.0,
				animate ? (-(0.5 + this.scrollSpeed * !this.firstFrame) / this.cellBuffer.height) : 0.0)
			this.parametricBrushShader.uniforms.screenSpace.set2f (1.0 / this.cellBuffer.width, 1.0 / this.cellBuffer.height)
			this.parametricBrushShader.uniforms.brushSize.set1f (Math.max (this.brushSize, texelSize))
			this.parametricBrushShader.uniforms.seed.set2f (Math.random (), Math.random ())
			this.parametricBrushShader.uniforms.noise.set1i (this.brushType == 'noise')
			this.parametricBrushShader.uniforms.fill.set1f (this.eraseMode ? 0.0 : 1.0)
			this.parametricBrushShader.uniforms.animate.set1i (animate ? 1 : 0)
		    this.square.draw ()
		})
	},
	updateBrushBuffer: function () {
		this.brushBuffer.draw (function () {
			this.copyBrushShader.use ()
			this.copyBrushShader.attributes.position.bindBuffer (this.square)
			this.copyBrushShader.uniforms.source.bindTexture (this.cellBuffer, 0)
			this.copyBrushShader.uniforms.origin.set2fv (this.screenTransform.applyInverse (this.cloneStampPosition))
			this.copyBrushShader.uniforms.scale.set2f (
				this.brushBuffer.width / this.cellBuffer.width,
				this.brushBuffer.height / this.cellBuffer.height)
		    this.square.draw ()
			this.brushBufferReady = true;
		}, this)
	},
	draw: function () {
		this.gl.disable (this.gl.DEPTH_TEST)
		this.gl.clear (this.gl.COLOR_BUFFER_BIT)
		this.drawCellsShader.use ()
		this.drawCellsShader.attributes.position.bindBuffer (this.square)
		this.drawCellsShader.uniforms.transform.setMatrix (this.screenTransform)
		this.drawCellsShader.uniforms.cells.bindTexture (this.cellBuffer, 0)
		this.square.draw ()
		this.drawCloneStamp ()
	},
	drawCloneStamp: function () {
		if (this.isCloning) {
			this.brushCursorShader.use ()
			this.brushCursorShader.attributes.position.bindBuffer (this.square)
			this.brushCursorShader.uniforms.transform.setMatrix (new Transform ()
				.translate (this.cloneStampPosition)
				.scale ([this.brushBuffer.width / this.cellBuffer.width, this.brushBuffer.height / this.cellBuffer.height, 0.0])
				.multiply (this.screenTransform))
			this.brushCursorShader.uniforms.color.bindTexture (this.brushBuffer, 0)
			this.square.draw ()
		}
	},
	noGL: function () {
		$('.no-webgl').modal ('show')
	}
})

$(document).ready (function () {
	var life = new Life ({
		canvas: $('.viewport').get (0)
	})
})