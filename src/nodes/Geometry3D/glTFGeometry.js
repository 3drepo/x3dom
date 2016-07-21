/** @namespace x3dom.nodeTypes */
/*
 * X3DOM JavaScript Library
 * http://www.x3dom.org
 *
 * (C)2016 3DRepo London
 * Licensed under the MIT
 *
 * Author: Sebastian Friston (based on ExternalGeometry.js)
 */
var ATTRIBUTE_TARGET = 34962;
var INDEX_TARGET     = 34963;

/* ### glTFGeometry ### */
x3dom.registerNodeType(
    "glTFGeometry",
    "Geometry3D",
    defineClass(x3dom.nodeTypes.X3DSpatialGeometryNode,

        /**
         * Constructor for glTFGeometry
         * @constructs x3dom.nodeTypes.glTFGeometry
         * @x3d 3.3
         * @component Geometry3D
         * @extends x3dom.nodeTypes.X3DSpatialGeometryNode
         * @param {Object} [ctx=null] - context object, containing initial settings like namespace
         * @classdesc The glTFGeometry node loads data from a glTF resource.
         * This node is typically created by a glTF node, outside the xml dom, though this node can exist as a
         * first-class citizen in the xml dom.
         **/
         function (ctx) {
            x3dom.nodeTypes.glTFGeometry.superClass.call(this, ctx);

            /**
             * Defines the uri to the glTF header file.
             * The actual mesh loaded into this node is set by the mesh property.
             *
             * @var {x3dom.fields.MFString} url
             * @memberof x3dom.nodeTypes.glTFGeometry
             * @initvalue []
             * @field x3dom
             * @instance
             */
            this.addField_SFString(ctx, 'url', null);

            /**
             * Defines which mesh will be loaded from the glTF definition. This member must be set.
             *              *
             * @var {x3dom.fields.MFString} url
             * @memberof x3dom.nodeTypes.glTFGeometry
             * @initvalue []
             * @field x3dom
             * @instance
             */
            this.addField_SFString(ctx, 'mesh', null);

            /**
             * Flag that specifies whether each primitive should be considered a submesh of a single multipart mesh
             * @var {x3dom.fields.SFBool} isMultipart
             * @memberof x3dom.nodeTypes.glTFGeometry
             * @initvalue false
             * @field x3dom
             * @instance
             */
            this.addField_SFBool(ctx, 'isMultipart', false);

            /**
             * Flag that specifies whether each primitive should be considered a submesh of a single multipart mesh
             * @var {x3dom.fields.SFBool} isMultipart
             * @memberof x3dom.nodeTypes.glTFGeometry
             * @initvalue false
             * @field x3dom
             * @instance
             */
            this.addField_SFBool(ctx, 'idsPerVertex', false);

            //initialization of rendering-related X3DOM structures
            this._mesh._invalidate = false;
            this._mesh._numCoords  = 0;
            this._mesh._numFaces   = 0;

            //index of the current URL, used to download data - if downloading fails, this index is increased
            this._currentURLIdx = 0;

            //the gltf header object, if this node is being created by a glTF node, it may set this to save downloading
            //the gltf again.
            this.gltfHeader = null;

            //the pathname of the gltf header. external resource uris will be relative to this. if the gltf header
            //is set directly, this must also be set.
            this.gltfHeaderBaseURI = null;

			// Bounding box read from the header
			this.headerBBoxSet    = false;
			this.headerBBoxSize   = new x3dom.fields.SFVec3f(-1.0,-1.0,-1.0);
			this.headerBBoxCenter = new x3dom.fields.SFVec3f(0.0, 0.0, 0.0);

            //caches the gltf buffers
            this._bufferData = {};

			this.bufferContents = null;

            this._bufferViewGLBuffers = {};

            this.memoryManagerRegistered = false;

	    this.myMeshes      = [];
            this.visibleMeshes = [];
        },

        {
            //----------------------------------------------------------------------------------------------------------
            // PUBLIC FUNCTIONS
            //----------------------------------------------------------------------------------------------------------

            /**
             * Updates the render data, stored in the given objects, with data from this glTFGeometry.
             * If necessary, the referenced files are downloaded first.
             *
             * @param {Object} shape - x3dom shape node
             * @param {Object} shaderProgram - x3dom shader program
             * @param {Object} gl - WebGL context
             * @param {Object} viewarea - x3dom view area
             * @param {Object} context - x3dom context object
             */
            updateRenderData: function(shape, shaderProgram, gl, viewarea, context) {
                var that = this;
                var xhr;

                //check if there is still memory available
                if (x3dom.BinaryContainerLoader.outOfMemory) {
                    return;
                }

                if(!that.gltfHeader){
                    if(that._xmlNode.gltfHeader){
                        that.gltfHeader = that._xmlNode.gltfHeader;
                        that.gltfHeaderBaseURI = that._xmlNode.gltfHeaderBaseURI;
                    }
                }

				if (that._xmlNode)
				{
					that.addMemoryManagerCallback = this._xmlNode.addMemoryManagerCallback;
					that.memoryManager = this._xmlNode.memoryManager;
				} else {
					x3dom.debug.logError("Member must have access to callback member be set by glTF node for now");
				}

                if(!that.gltfHeader){
                    x3dom.debug.logError("Member glTFHeader must be set by glTF node for now");
                }

                var requestedMeshName = that._vf.mesh;
                if(!requestedMeshName){
                    x3dom.debug.logError("glTFGeometry node has no mesh specified");
                }

                var requestedMesh = that.gltfHeader.meshes[requestedMeshName];
                if(!requestedMesh){
                    x3dom.debug.logError("glTFGeometry node has an invalid mesh specified - mesh missing in header");
                }

                that._nameSpace.setBaseURL(that.gltfHeaderBaseURI);

                that._downloadBuffers(function(){
                    that._updateRenderData(shape, shaderProgram, gl, requestedMesh);
                });

                //TODO: check SOURCE child nodes
                shape._nameSpace.doc.downloadCount += 1;

            },

            //----------------------------------------------------------------------------------------------------------

            //----------------------------------------------------------------------------------------------------------
            // PRIVATE FUNCTIONS
            //----------------------------------------------------------------------------------------------------------

			_setBoundingBox: function(header, primitives)
			{
				"use strict";

				if (primitives.length)
				{
					var firstVertexPrimitive = primitives[0].attributes["POSITION"];
					var minVertex = header.accessors[firstVertexPrimitive].min;
					var maxVertex = header.accessors[firstVertexPrimitive].max;

					for(var i = 1; i < primitives.length; i++)
					{
						var c_idx = 0;
						var primitivePosition = primitives[i].attributes["POSITION"];
						var minPrimitiveVertex = header.accessors[primitivePosition].min;
						var maxPrimitiveVertex = header.accessors[primitivePosition].max;

						for(c_idx = 0; c_idx < 3; c_idx++)
						{
							if (minVertex[c_idx] > minPrimitiveVertex[c_idx])
							{
								minVertex[c_idx] = minPrimitiveVertex[c_idx];
							}

							if (maxVertex[c_idx] < maxPrimitiveVertex[c_idx])
							{
								maxVertex[c_idx] = maxPrimitiveVertex[c_idx];
							}
						}
					}

					this.headerBBoxCenter.x = (minVertex[0] + maxVertex[0]) * 0.5;
					this.headerBBoxCenter.y = (minVertex[1] + maxVertex[1]) * 0.5;
					this.headerBBoxCenter.z = (minVertex[2] + maxVertex[2]) * 0.5;

					this.headerBBoxSize.x   = maxVertex[0] - minVertex[0];
					this.headerBBoxSize.y   = maxVertex[1] - minVertex[1];
					this.headerBBoxSize.z   = maxVertex[2] - minVertex[2];

					this._parentNodes[0]._xmlNode.setAttribute("bboxCenter", this.headerBBoxCenter.toGL().join(","));
					this._parentNodes[0]._xmlNode.setAttribute("bboxSize", this.headerBBoxSize.toGL().join(","));
					this._parentNodes[0]._graph.volume.valid = false;

					this._mesh._vol.setBoundsByCenterSize(this.headerBBoxCenter, this.headerBBoxSize);

					this.headerBBoxSet    = true;
				}
			},

            /**
             * Updates the render data stored in the given objects with data read from the gltf.
             *
             * @param {Object} shape - x3dom shape node
             * @param {Object} shaderProgram - x3dom shader program
             * @param {Object} gl - WebGL context
             * @param {Object} requestedMesh - an object containing the properties of the mesh to be rendered
             * @private
             */
            _updateRenderData: function(shape, shaderProgram, gl, requestedMesh)
            {
                //todo: replace with isMultipart flag
                this._updateRenderDataForMultipart(shape, gl, requestedMesh);

                shape._nameSpace.doc.downloadCount -= 1;
            },

            _updateRenderDataForPrimitive: function(shape, gl, requestedPrimitive){

                var INDEX_BUFFER_IDX    = 0;
                var POSITION_BUFFER_IDX = 1;
                var NORMAL_BUFFER_IDX   = 2;
                var TEXCOORD_BUFFER_IDX = 3;
                var COLOR_BUFFER_IDX    = 4;
                var ID_BUFFER_IDX       = 5;

                var MAX_NUM_BUFFERS_PER_DRAW = 6;

                var that = this;
                var primitive = requestedPrimitive;

                // materials are set per-primitive in gltf, but per shape in x3dom, so only one primitive will be active
                // at a time

                var meshIdx = 0;
                var bufferOffset = 0;

                // 1. set-up the shape

                shape._webgl.primType    = [];
                shape._webgl.indexOffset = [];
                shape._webgl.drawCount   = [];

                //hints for stats display
                this._mesh._numCoords   = 0;
                this._mesh._numFaces    = 0;


                // 2. check if the primitive uses indices and set them if so, otherwise, set the draw count from the
                // positions member
                //todo: perhaps not make it have to be the positions member? if we

                if((!primitive.indices) && (!primitive.attributes.position)) {
                    x3dom.debug.logError("glTFGeometry node encountered mesh with neither indices or position attributes");
                    return;
                }

                that._createBufferViews(gl);

                if (primitive.indices)
                {
                    shape._webgl.externalGeometry =  1; //indexed EG

                    var indexView = that._getAccessorView(primitive.indices, gl);

                    shape._webgl.indexOffset[meshIdx] = indexView.byteOffset;
                    shape._webgl.indexType = gl.UNSIGNED_SHORT;
                    shape._webgl.buffers[INDEX_BUFFER_IDX + bufferOffset] = indexView.glBuffer;
                    shape._webgl.drawCount[meshIdx]   = indexView.elementCount;

                    this._mesh._numFaces += that._getPrimitiveCount(primitive.mode, indexView.count);
                }
                else
                {
                    shape._webgl.externalGeometry = -1; //non-indexed EG

                    var positionView = that._getAccessorView(primitive.attributes.position, gl);
                    shape._webgl.drawCount[meshIdx] = positionView.elementCount;

                    this._mesh._numFaces +=  that._getPrimitiveCount(primitive.mode, positionView.count);
                }

                // 3. set up the primitive type

                shape._webgl.primType[meshIdx] = primitive.mode;


                // 4. process the attributes. x3dom does not support arbitrary attributes, so we cherry pick the supported
                // ones
                //todo: eventally (since the material parameters can be defined in the glTF) we want these queries to be
                //based on those

                var shaderParameterCtor = function (bufferIdx, gltfSemantic, x3domTypeID, x3domShortTypeID) {
                    return {
                        IDX : bufferIdx,
                        Name : gltfSemantic,
                        x3domTypeID : x3domTypeID,
                        x3domShortTypeID : x3domShortTypeID
                    };
                };

                var shaderAttributes = [
                    shaderParameterCtor(POSITION_BUFFER_IDX, "POSITION", "coord", "Pos"),
                    shaderParameterCtor(NORMAL_BUFFER_IDX, "NORMAL", "normal", "Norm"),
                    shaderParameterCtor(TEXCOORD_BUFFER_IDX, "TEXCOORD_0", "texCoord", "Tex"),
                    shaderParameterCtor(COLOR_BUFFER_IDX, "COLOR", "color", "col"),
                    shaderParameterCtor(ID_BUFFER_IDX, "IDMAP", "id", "Id")
                ];

                shaderAttributes.forEach(function(attribute)
                {
                    if(primitive.attributes[attribute.Name]){
                        var attributeView = that._getAccessorView(primitive.attributes[attribute.Name], gl);
                        shape._webgl.buffers[attribute.IDX + bufferOffset] = attributeView.glBuffer;

                        shape["_" + attribute.x3domTypeID + "StrideOffset"][0] = attributeView.byteStride;
                        shape["_" + attribute.x3domTypeID + "StrideOffset"][1] = attributeView.byteOffset;
                        shape._webgl[attribute.x3domTypeID + "Type"]           = attributeView.componentType;

                        that._mesh["_num" + attributeView.x3domShortTypeID + "Components"] = attributeView.elementCount;
                    }
                });

                // 5. handle special cases - hints for stats display and id

                if(primitive.attributes[shaderAttributes[0].Name]){
                    var positionView = that._getAccessorView(primitive.attributes[shaderAttributes[0].Name], gl);
                    this._mesh._numCoords += positionView.elementCount;
                }

                // 6. notify renderer

                shape._dirty.shader = true;
                shape._nameSpace.doc.needRender = true;

                x3dom.BinaryContainerLoader.checkError(gl);

				that._setBoundingBox(that.gltfHeader, [primitive]);
            },

            //----------------------------------------------------------------------------------------------------------
            // HELPER FUNCTIONS
            //----------------------------------------------------------------------------------------------------------

            _downloadBuffers: function(callback){

                var that = this;
				var header = that.gltfHeader;

                that._bufferDownloadCompleteCallback = callback;

				// First check whether or not there are
				// bufferviews attached for this mesh
				that._bufferViews = [];
				var bufferView;

				for (var k in header.bufferViews)
				{
					if (header.bufferViews.hasOwnProperty(k))
					{
						bufferView = header.bufferViews[k];

						if (bufferView.extras.refID === that._DEF)
						{
							bufferView.key = k;
							that._bufferViews.push(bufferView);
						}
					}
				}

				if (that._bufferViews.length)
				{
					var bufferViews = {};
					bufferViews[INDEX_TARGET] = {};
					bufferViews[ATTRIBUTE_TARGET] = {};

					var bufferView;

					// If we have buffew views then load then singularly.
					for (var bufferViewID in that._bufferViews)
					{
						if (that._bufferViews.hasOwnProperty(bufferViewID))
						{
							bufferView = that._bufferViews[bufferViewID];
							var bufferId = bufferView.buffer;
							var buffer = that.gltfHeader.buffers[bufferId];
							var target = bufferView.target;

							if (!bufferViews[target].hasOwnProperty(bufferId))
							{
								bufferViews[target][bufferId] = { byteArray: [], bufferViews: [] };
							}

							bufferViews[target][bufferId].byteArray.push([bufferView.byteOffset, bufferView.byteOffset + bufferView.byteLength]);
							bufferViews[target][bufferId].bufferViews.push(bufferView);
						}
					}

					var hasPopBuffers = true;

					// Detect whether or not this is POP buffer compatible
					for (var accID in that.gltfHeader.accessors)
					{
						var accessor = that.gltfHeader.accessors[accID];

						if (true || !accessor.extras.lodRef)
						{
							hasPopBuffers = false;
							break;
						} else {
							var bufferViewID = accessor.bufferView;
							var bufferView   = that.gltfHeader.bufferViews[bufferViewID];
							var bufferId     = bufferView.buffer;

							if (!bufferViews[INDEX_TARGET][bufferId].popBufferByteArray)
							{
								bufferViews[INDEX_TARGET][bufferId].popBufferByteArray = [];
								bufferViews[INDEX_TARGET][bufferId].popBufferAccessors = [];
							}

							var popBufferByteArray = bufferViews[INDEX_TARGET][bufferId].popBufferByteArray;
							var popBufferAccessors = bufferViews[INDEX_TARGET][bufferId].popBufferAccessors;

							var submeshStart = null;

							for(var l = 0; l < accessor.extras.lodRef.length; l++)
							{
								var lodRef = accessor.extras.lodRef[l];

								if (!popBufferByteArray[l])
								{
									popBufferByteArray[l] = [];
								}

								if (!submeshStart)
								{
									submeshStart = accessor.byteOffset + bufferView.byteOffset;
								} else {
									submeshStart = submeshEnd;
								}

								var submeshEnd   = submeshStart + (lodRef * 2);
								popBufferByteArray[l].push([submeshStart, submeshEnd]);
							}

							popBufferAccessors.push(accessor);
						}
					}

					for (var target in bufferViews)
					{
						var targetBufferViews = bufferViews[target];

						for (var bufferId in targetBufferViews)
						{
							var buffer = that.gltfHeader.buffers[bufferId];
							var myBufferViews = targetBufferViews[bufferId].bufferViews;

							for (var i = 0; i < myBufferViews.length; i++)
							{
								bufferView = myBufferViews[i];
								bufferView.type    = buffer.type;
								bufferView.content = null;
								bufferView.done    = false;
							}

							if (targetBufferViews[bufferId].popBufferByteArray && target == INDEX_TARGET)
							{
								var targetPopBufferByteArray = targetBufferViews[bufferId].popBufferByteArray;
								var numLods = targetPopBufferByteArray.length;
								var bufferURIs = [];

								for (var l = 0; l < numLods; l++)
								{
									bufferURIs[l] = that._nameSpace.getURL(buffer.uri) + "?bytes=" + JSON.stringify(targetPopBufferByteArray[l]);
								}

								var startDownload = function(myBufferViews, l) {
									if (!bufferURIs[l + 1])
									{
										myBufferViews[0].done = true;
									}

									if (bufferURIs[l])
									{
										that._nameSpace.doc.manageDownload(bufferURIs[l], buffer.type, function(xhr) {
											that._onceDownloadedPopBufferViews(xhr, myBufferViews, l);
											startDownload(myBufferViews, l + 1);
										});
									}
								};

								startDownload(myBufferViews, 0);
							} else {
								var bufferURI = that._nameSpace.getURL(buffer.uri) + "?bytes=" + JSON.stringify(targetBufferViews[bufferId].byteArray);

								that._nameSpace.doc.manageDownload(bufferURI, buffer.type, function(myBufferViews) {
									return function(xhr) {
										that._onceDownloadedBufferViews(xhr, myBufferViews);
									};
								}(myBufferViews));
							}
						}
					}
				} else {
					// create the list of buffers we want to download
					for(bufferId in that.gltfHeader.buffers) {
						if (!that._bufferData[bufferId]) {
							var buffer = that.gltfHeader.buffers[bufferId];
							that._bufferData[bufferId] = {
								uri : this._nameSpace.getURL(buffer.uri),
								type : buffer.type,
								content : null,
								done : false
							};
						}
					}

					// start the downloads
					for(bufferId in that._bufferData) {
						var buffer = that._bufferData[bufferId];

						that._nameSpace.doc.manageDownload(buffer.uri, buffer.type, function(xhr) {
							that._onceDownloadedBuffer(xhr, buffer);
						});
					}
				}
            },

			_onceDownloadedBufferViews: function(xhr, bufferViews) {
				"use strict";

                var that = this;
				var i = 0;
				var finished = true;

                if(xhr.status === 200 || xhr.status === 0)
                {
					that.bufferContents = new Uint8Array(xhr.response);
                }

				var totalBytes = 0;

				for (i = 0; i < bufferViews.length; i++)
				{
					var bufferView = bufferViews[i];

					bufferView.content = that.bufferContents.slice(totalBytes, totalBytes + bufferView.byteLength);
					bufferView.done    = true;

					totalBytes += bufferView.byteLength;
				}

				if (that._bufferViews.length)
				{
					for (i = 0; i < that._bufferViews.length; i++)
					{
						if (that._bufferViews[i].done !== true) {
							finished = false;
							break;
						}
					}
				}

                if(finished)
                {
                    that._bufferDownloadCompleteCallback();
                }
			},

			_onceDownloadedPopBufferViews: function(xhr, bufferViews, popLevel) {
				"use strict";

				var bufferView = bufferViews[0];

				if (bufferViews.length !== 1)
				{
					console.error("Shouldn't happen");
				}

                var that = this;
				var bufferContents = null;
				var i = 0;
				var finished = true;

				var totalBytes = 0;

				if (!bufferView.popContent)
				{
					bufferView.popContent = [];
				}

				if(xhr.status === 200 || xhr.status === 0)
                {
					bufferView.popContent[popLevel] = new Uint8Array(xhr.response);
				}

				if (that._bufferViews.length)
				{
					for (i = 0; i < that._bufferViews.length; i++)
					{
						if (that._bufferViews[i].done !== true) {
							finished = false;
							break;
						}
					}
				}

                if(finished)
                {
                    that._bufferDownloadCompleteCallback();
                }
			},

            _onceDownloadedBuffer: function(xhr, buffer){
                var that = this;

                buffer.done = true;
                if(xhr.status === 200 || xhr.status === 0)
                {
                    buffer.content = new Uint8Array(xhr.response);
                }

                var finished = true;

				for(bufferId in that._bufferData)
				{
					if(that._bufferData[bufferId].done !== true){
						finished = false;
						break;
					}
				}

                if(finished)
                {
                    that._bufferDownloadCompleteCallback();
                }
            },

            /**
             * Creates the GL_ARRAY_BUFFER and GL_ELEMENT_ARRAY bufferViews
             *
             * @param {string} accessorName - id of the accessor to use to view the buffer
             * @param {Function} Function to call when done
             */
            _createBufferViews: function(gl){

                var that = this;

                for(bufferViewId in that.gltfHeader.bufferViews)
                {
                    if(!that._bufferViewGLBuffers[bufferViewId]){

                        var bufferView = that.gltfHeader.bufferViews[bufferViewId];

                        var newBuffer = gl.createBuffer();
                        gl.bindBuffer(bufferView.target, newBuffer);

                   /*     var chunkDataView = new Uint8Array(
                            that._bufferData[bufferView.buffer].content,
                            bufferView.byteOffset,
                            bufferView.byteLength); */

                        var chunkDataView = that._bufferData[bufferView.buffer].content.subarray(bufferView.byteOffset, bufferView.byteOffset + bufferView.byteLength);

                        gl.bufferData(bufferView.target, chunkDataView, gl.STATIC_DRAW);

                        that._bufferViewGLBuffers[bufferViewId] = newBuffer;
                    }
                }
            },

            /**
             * Creates a helper object to provide a consistent set of properties about an attribute view
             *
             * @param {string} accessorName - id of the accessor to use to view the buffer
             * @returns {Object} an object describing a buffer view
             */
            _getAccessorView: function(accessorName){

                var that = this;

                var accessors = this.gltfHeader.accessors;
                var accessor = accessors[accessorName];

                var view = {
                    glBuffer : that._bufferViewGLBuffers[accessor.bufferView],
                    elementCount : accessor.count,
                    byteOffset : accessor.byteOffset,
                    byteStride : accessor.byteStride,
                    componentType : accessor.componentType
                };

                return view;
            },

            _getPrimitiveCount: function(mode, elementCount) {
                // ids from https://github.com/KhronosGroup/glTF/blob/master/specification/schema/mesh.primitive.schema.json
                // counts from https://www.opengl.org/wiki/Primitive#Line_primitives
                switch (mode) {
                    case 0: //points
                        return elementCount;
                        break;
                    case 1: //lines
                        return Math.floor(elementCount / 2);
                        break;
                    case 2: //line loop
                        return elementCount;
                        break;
                    case 3: //line strip
                        return elementCount - 1;
                        break;
                    case 4: //triangles
                        return Math.floor(elementCount / 3);
                        break;
                    case 5: //triangle strip
                        return elementCount - 2;
                        break;
                    case 6: //triangle fan
                        return elementCount - 2;
                        break;
                    default:
                        x3dom.debug.logError("glTFGeometry encountered unknown primitive type " + mode);
                }
            },

            //----------------------------------------------------------------------------------------------------------
            // GLTF MULTIPART FUNCTIONALITY
            //----------------------------------------------------------------------------------------------------------

			_createGLBuffers: function(gl, header, bufferKey, attrKeys, buffers, lengths, target, objs)
			{
				"use strict";

				// Create index buffer
				var totalBytes = 0;
				var attrBuffers = [];
				var attrLengths = [];

				for (i = 0; i < attrKeys.length; i++)
				{
					var key = attrKeys[i];

					if (header.bufferViews[key].target === target)
					{
						attrBuffers.push(buffers[i]);
						attrLengths.push(lengths[key]);
						totalBytes += lengths[key];
					}
				}

				if (totalBytes)
				{
					console.log("ATTR: " + attrKeys.join(",") + " TOTAL: " + totalBytes);

					var newGLBuffer = gl.createBuffer();
					gl.bindBuffer(target, newGLBuffer);
					gl.bufferData(target, totalBytes, gl.STATIC_DRAW);


					var oldBuffers = [];

					totalBytes = 0;

					for (i = 0; i < attrBuffers.length; i++)
					{
						if (attrBuffers[i].byteLength)
						{
							gl.bufferSubData(target, totalBytes, new Uint8Array(attrBuffers[i], 0, attrLengths[i]));
							objs[i].glBufferOffset = totalBytes;

							oldBuffers.push(objs[i].glBuffer);
							objs[i].glBuffer       = newGLBuffer;

							totalBytes += attrLengths[i];
						}
					}

					for(var i = 0; i < oldBuffers.length; i++)
					{
						gl.deleteBuffer(oldBuffers[i]);
					}
				}
			},

            _updateRenderDataForMultipart: function(shape, gl, requestedMesh)
            {
                //This is a multipart mesh. Each primitive is a submesh. The primitive accessors define segments of a
                //buffer that pertain to a unique object, but all segments can be combined and drawn with one call.
                //We will create a proxy primitive that appears to the renderer for the most part like a typcial mesh,
                //but underneath the buffers are constantly rebuilt to remove unseen geometry.

                var that = this;
                var header = that.gltfHeader;
				var i;
				that.gl = gl;

				that.addMemoryManagerCallback(function(event) {

					// Here we recreate the OpenGL buffers
					if (that._DEF === event.data.destination)
					{
						if (event.data.type === "registered")
						{
							that.memoryManagerRegistered = true;
						} else {

							var gl = that.gl;
							var header = that.gltfHeader;

							if (!that._multipart.indices)
							{
								that._multipart.indices = {};
							}

							that._multipart.indices.count = event.data.count
							that._createGLBuffers(gl, header, event.data.destination, event.data.keys, event.data.buffers, event.data.lengths, INDEX_TARGET, [that._multipart.indices]);

							var attributeObjects = [];

							for (i = 0; i < event.data.keys.length; i++)
							{
								var key = event.data.keys[i];

								for (var attrKey in that._multipart.attributes)
								{
									if (that._multipart.attributes.hasOwnProperty(attrKey))
									{
										var attribute = that._multipart.attributes[attrKey];

										if (attribute.bufferView === key)
										{
											attributeObjects.push(attribute);
										}
									}
								}
							}

							that._createGLBuffers(gl, header, event.data.destination, event.data.keys, event.data.buffers, event.data.lengths, ATTRIBUTE_TARGET, attributeObjects);

							that.memoryManager.postMessage(
								{
									id: that._DEF,
									type: "returnBuffers",
									keys: event.data.keys,
									buffers: event.data.buffers,
									lengths: event.data.lengths
								}, event.data.buffers);

							that._rebindMultipart(that._multipart);
						}
					}
				});

				//debugger;
				var myBuffers = [];

				if (!that._bufferViews)
				{
					var bufferView;
					that._bufferViews = [];

					for (var k in header.bufferViews)
					{
						if (header.bufferViews.hasOwnProperty(k))
						{
							bufferView = header.bufferViews[k];

							if (bufferView.extras.refID === that._DEF)
							{
								bufferView.key = k;
								that._bufferViews.push(bufferView);
							}
						}
					}

					var fullBuffer = that._bufferData[that._DEF.substring(0, that._DEF.length-2)].content;

					for (var i = 0; i < that._bufferViews.length; i++)
					{
						bufferView = that._bufferViews[i];
						myBuffers.push(fullBuffer.slice(bufferView.byteOffset, bufferView.byteOffset + bufferView.byteLength).buffer);
					}
				} else {
					for (var i = 0; i < that._bufferViews.length; i++)
					{
						if(that._bufferViews[i].popContent)
						{
							for (var l = 0; l < that._bufferViews[i].popContent.length; l++)
							{
								if (that._bufferViews[i].popContent[i])
								{
									myBuffer.push(that._bufferViews[i].popContent[l].buffer);
								}
							}
						} else {
							myBuffers.push(that._bufferViews[i].content.buffer);
						}
					}
				}

				var submeshes = that._createMultipartSubmeshes(requestedMesh);

				that.memoryManager.postMessage({
					type: "registerMe",
					id: that._DEF,
					ops: 2,
					bufferViews: that._bufferViews,
					submeshes: submeshes
				},
				myBuffers);

                var multipart = {};
                that._multipart = multipart;
                multipart.shape = shape;
                multipart.gl = gl;
                shape._gltfMultipart = multipart;


                // find all the attributes in use by these submeshes
                multipart.attributes = that._createMultipartAttributes(requestedMesh);

                // create the binding parameters for the accessors
//                that._createAttributeBindingParameters(multipart.attributes, multipart.gpublocks, multipart.submeshes);

                multipart.mode = requestedMesh.primitives[0].mode;
				/*
                multipart.indices = {
                  gpublock : multipart.gpublocks[multipart.submeshes[0].indices.bufferView]
                };
				*/

				multipart.primitives = requestedMesh.primitives;

				that._setBoundingBox(header, multipart.primitives);

	            //that._rebuildMultipart(multipart);

				/*
                that._graphicsMemoryManager = x3dom.GraphicsMemoryManager.getGraphicsMemoryManager(gl);

                // create a set of objects representing where to find the geometry of each submesh
                multipart.submeshes = that._createMultipartSubmeshes(requestedMesh);

                // create a set of gpu blocks, one for each bufferview
                multipart.gpublocks = that._createGPUBlocksForBufferViews(that._graphicsMemoryManager);

                multipart.primitives = requestedMesh.primitives;
                for(var i = 0; i < multipart.primitives.length; i++)
                {
                    multipart.primitives[i]._visible = true;
                }

            //    multipart.primitives[1]._visible = false;
            //    multipart.primitives[150]._visible = false;
            //    multipart.primitives[80]._visible = false;
            //    multipart.primitives[59]._visible = false;

				this._setBoundingBox(header, multipart.primitives);

                that._rebuildMultipart(multipart);

                that._graphicsMemoryManager.rebuild();
				*/
            },

		changeLOD: function(IDs, LODs)
		{
			if (this.memoryManagerRegistered)
			{
				this.memoryManager.postMessage(
					{
						id: this._DEF,
						type: "changeLOD",
						ids: IDs,
						lods: LODs
					}
				);
			}
		},

		changeVisibility: function(visibleMeshes)
		{
			var changed = false;

			var newIDs    = Object.keys(visibleMeshes);
			var oldIDs    = Object.keys(this.visibleMeshes);

			var newNumIDs = newIDs.length;
			var oldNumIDs = oldIDs.length;

			if (newNumIDs === oldNumIDs)
			{
				for (var i = 0; i < newIDs.length; i++)
				{
					if (newIDs[i] !== oldIDs[i])
					{
						changed = true;
						break;
					}
				}
			} else {
				changed = true;
			}

			if (changed)
			{
				if (this.memoryManagerRegistered)
				{
					this.memoryManager.postMessage(
						{
							id: this._DEF,
							type: "changeVisibility",
							meshes: visibleMeshes
						}
					);
				}

				this.visibleMeshes = visibleMeshes;
			}
		},

            writeGPUBlock: function( block )
            {
                var that = this;

                if(block === that._multipart.indices.gpublock)
                {
                    // the request is for index data - rebuild the indices as we go
                    for(var s = 0; s < block._segments.length; s++)
                    {
                        var indices = block._segments[s];
                        var bufferData = that._getBufferViewSubData(indices.bufferView, indices.startBytes, indices.lengthBytes);

                        var indexDataView = new Uint16Array(bufferData.buffer, 0, indices.count);
                        for(var i = 0; i < indexDataView.length; i++)
                        {
                            indexDataView[i] = indexDataView[i] - indices.min + indices.indexOffset;
                        }

                        block.write(indexDataView.buffer, indices.currentOffset);
                    }
                }
                else
                {
                    // regular attribute data - get the blobs and write them to the gpu
                    for(var i = 0; i < block._segments.length; i++)
                    {
                        var segment = block._segments[i];
                        var data = that._getBufferViewSubData(segment.bufferView, segment.startBytes, segment.lengthBytes);

                        block.write(data, segment.currentOffset);
                    }
                }

                that._rebindMultipart(that._multipart);
            },

            _rebindMultipart: function(multipart){

                var that = this;
                var shape = multipart.shape;
                var gl = multipart.gl;

                var INDEX_BUFFER_IDX    = 0;
                var POSITION_BUFFER_IDX = 1;
                var NORMAL_BUFFER_IDX   = 2;
                var TEXCOORD_BUFFER_IDX = 3;
                var COLOR_BUFFER_IDX    = 4;
                var ID_BUFFER_IDX       = 5;

                var shaderParameterCtor = function (bufferIdx, gltfSemantic, x3domTypeID, x3domShortTypeID) {
                    return {
                        IDX : bufferIdx,
                        Name : gltfSemantic,
                        x3domTypeID : x3domTypeID,
                        x3domShortTypeID : x3domShortTypeID
                    };
                };

                var gltfAttributeMap = {
                    POSITION: shaderParameterCtor(POSITION_BUFFER_IDX, "POSITION", "coord", "Pos"),
                    NORMAL: shaderParameterCtor(NORMAL_BUFFER_IDX, "NORMAL", "normal", "Norm"),
                    TEXCOORD_0: shaderParameterCtor(TEXCOORD_BUFFER_IDX, "TEXCOORD_0", "texCoord", "Tex"),
                    COLOR: shaderParameterCtor(COLOR_BUFFER_IDX, "COLOR", "color", "col"),
                    IDMAP: shaderParameterCtor(ID_BUFFER_IDX, "IDMAP", "id", "Id")
                };

                var primitiveCount = multipart.indices.count / 3;

                // set up the webgl references and counts

                var meshIdx = 0;
                var bufferOffset = 0;

                shape._webgl.primType    = [];
                shape._webgl.indexOffset = [];
                shape._webgl.drawCount   = [];
//                    that._mesh._numCoords   = 0;
//                    that._mesh._numFaces    = 0;

                shape._webgl.externalGeometry =  1; //indexed EG
                shape._webgl.indexType = gl.UNSIGNED_SHORT;
                shape._webgl.indexOffset[meshIdx] = multipart.indices.glBufferOffset;
                shape._webgl.buffers[INDEX_BUFFER_IDX + bufferOffset] = multipart.indices.glBuffer;
                shape._webgl.drawCount[meshIdx] = multipart.indices.count;

                // 3. set up the primitive type

                shape._webgl.primType[meshIdx] = multipart.mode;

                for(var attributeId in multipart.attributes)
                {
                    var attribute = multipart.attributes[attributeId];
                    var webglattribute = gltfAttributeMap[attributeId]

                    shape._webgl.buffers[webglattribute.IDX + bufferOffset]     = attribute.glBuffer;
                    shape["_" + webglattribute.x3domTypeID + "StrideOffset"][0] = attribute.byteStride;
                    shape["_" + webglattribute.x3domTypeID + "StrideOffset"][1] = attribute.byteOffset + attribute.glBufferOffset;
                    shape._webgl[webglattribute.x3domTypeID + "Type"]           = attribute.componentType;

                }

                // set the flags

                shape._dirty.shader = true;
                shape._nameSpace.doc.needRender = true;

                x3dom.BinaryContainerLoader.checkError(gl);
            },

            _rebuildMultipart: function(multipart){

                // update the attribute data layout
                for(var bufferViewId in multipart.gpublocks) {

                    var totalBytes = 0;
                    var gpublock = multipart.gpublocks[bufferViewId];
                    gpublock._segments = [];

                    for (var i = 0; i < multipart.submeshes.length; i++) {

                        var submesh = multipart.submeshes[i];
                        if(submesh.primitive._visible) {
                            //todo: worth precomputing a list of segments for each gpublock to save these lookups?
                            var segment = submesh.segments[bufferViewId];
                            if(segment) {
								/*
								if (submesh.primitive.extras && submesh.primitive.extras.refID)
								{
									segment.id = submesh.primitive.extras.refID;
								}
								*/

                                segment.currentOffset = totalBytes;
                                totalBytes += segment.lengthBytes;
                                gpublock._segments.push(segment); //store the segments in the gpu block to make rebuilding it easier

                            }
                        }
                    }

					console.log("BYTES: " + totalBytes);

                    gpublock.resize(totalBytes);
                }

                // update the indices size (the actual indices will be rebuilt when the data is written

                var totalBytes = 0;
                var totalElements = 0;
                var totalOffset = 0;
                var gpublock = multipart.indices.gpublock;
                gpublock._segments = [];
                for(var i = 0; i < multipart.submeshes.length; i++)
                {
                    var submesh = multipart.submeshes[i];
                    if(submesh.primitive._visible){
                        submesh.indices.currentOffset = totalBytes;
                        totalBytes += submesh.indices.lengthBytes;

                        submesh.indices.indexOffset = totalOffset;
                        //todo: make this more robust (get the count from the attribute accessors)
                        totalOffset += (submesh.indices.max + 1); //the max index should be the number of attributes in the submesh

                        totalElements += submesh.indices.count;

                        gpublock._segments.push(submesh.indices);
                    }
                }

                multipart.indices.count = totalElements;
                gpublock.resize(totalBytes);
            },

            /* Extract the vertex attributes from the gltf header */
            _createMultipartAttributes: function(requestedMesh)
            {
                var that = this;
                var header = that.gltfHeader;

                //collect the attributes that this multipart mesh will have

                var attributes = {};

                // all submeshes have the same attributes, of the same type
                var referencePrimitive = requestedMesh.primitives[0];

                for(var attributeName in referencePrimitive.attributes){
                    var accessor = header.accessors[referencePrimitive.attributes[attributeName]];
                    attributes[attributeName] =
                    {
                        name : attributeName,                       //name (gltf semantic)
                        bufferView: accessor.bufferView,            //the bufferView id - this will be used to index the gpu block
                        componentType : accessor.componentType,
                        byteStride : accessor.byteStride,
                        byteOffset : 0                              // the local offset into the gpu block for this attribute
                    };
                }

                return attributes;

            },

            _createGPUBlocksForBufferViews: function(graphicsMemoryManager){

                var that = this;
                var header = that.gltfHeader;

                var gpublocks = {};

                for(var bufferViewId in header.bufferViews)
                {
                    var bufferView = header.bufferViews[bufferViewId];
                    gpublocks[bufferViewId] = graphicsMemoryManager.getBlock(bufferView.target, that);
                }

                return gpublocks;
            },

            _createAttributeBindingParameters: function(attributes, gpublocks, submeshes){

                var that = this;
                var header = that.gltfHeader;

                for(var attributeId in attributes)
                {
                    var attribute = attributes[attributeId];

                    // add a reference to the gpu block
                    attribute.gpublock = gpublocks[attribute.bufferView];

                    // find the local offset into the segments for interleaved attributes - this should be the same for all
                    // segments
                    //todo: depending on cpu load, it may not be worth checking each offset once we are confident
                    //everything is workign
                    for(var i = 0; i < submeshes.length; i++){
                        var submesh = submeshes[i];
                        var accessor = header.accessors[submesh.primitive.attributes[attribute.name]];
                        var bufferSegment = submesh.segments[attribute.bufferView];
                        var offset = accessor.byteOffset - bufferSegment.startBytes;

                        if (!attribute.byteOffset) {
                            attribute.byteOffset = offset;
                        } else {
                            if (attribute.byteOffset != offset) {
                                x3dom.debug.logError("glTFMultipart Initialisation: interleaved vertex attributes have different offset multiples in different submeshes.")
                            }
                            //todo: could also check here type and stride
                        }
                    }
                }
            },

            // Create a list of all submeshes in this multipart mesh, and store along with them where to find their
            // attribute and index data
            _createMultipartSubmeshes: function(requestedMesh) {

                var that = this;
                var header = this.gltfHeader;

                var submeshes = [];

                for(var i = 0; i < requestedMesh.primitives.length; i++) {
                    var primitive = requestedMesh.primitives[i];

                    var submesh = {};

                    submesh.primitive = primitive;

                    // for each submesh, create the segments which tell the gltfnode how to load the geometry data into
                    // the gpu
                    submesh.segments = that._createSubmeshBufferSegments(primitive);
                    submesh.indices = that._createSubmeshIndices(primitive);

                    submeshes.push(submesh);
                }

                return submeshes;
            },


            /* For a submesh, get the bounds of the segments in the buffers which contain its attribute data. These
             * segments will be concatenated for all visible submeshes and then written to the gpu. There is one segment
             * per bufferview, and the bounds are defined by all the accessors which reference that bufferview */

            _createSubmeshBufferSegments: function(primitive)
            {
                var that = this;
                var header = that.gltfHeader;

                var segments = {};

                for(var attributeName in primitive.attributes){
                    var accessorId = primitive.attributes[attributeName];
                    var accessor = header.accessors[accessorId];
                    var bufferView = header.bufferViews[accessor.bufferView];

                    if(!segments[accessor.bufferView]){
                        segments[accessor.bufferView] = {
                            bufferView: accessor.bufferView,    // the source of the data
                            target : bufferView.target,         // the binding target for the data
                            startBytes : Infinity,              // where in the bufferview the segment starts
                            endBytes : 0,                       // where in the bufferview the segment ends
                            currentOffset : 0                   // where in the current gpu block this segment lies
                        };
                    }

                    segments[accessor.bufferView].startBytes = Math.min(segments[accessor.bufferView].startBytes, accessor.byteOffset);
                    segments[accessor.bufferView].endBytes = Math.max(segments[accessor.bufferView].endBytes, accessor.byteOffset + (accessor.byteStride * accessor.count));
                    segments[accessor.bufferView].lengthBytes = segments[accessor.bufferView].endBytes - segments[accessor.bufferView].startBytes;
                }

                return segments;
            },

            _createSubmeshIndices: function(primitive)
            {
                var that = this;
                var header = that.gltfHeader;

                var indices = {};
                var accessor = header.accessors[primitive.indices];

                indices.bufferView = accessor.bufferView;
                indices.target = accessor.target;
                indices.startBytes = accessor.byteOffset;
                indices.endBytes = indices.startBytes + (accessor.count * 2);
                indices.lengthBytes = indices.endBytes - indices.startBytes;
                indices.count = accessor.count;
                indices.min = accessor.min[0];
                indices.max = accessor.max[0];

				// Pop buffer enabled
				if (accessor.extras && accessor.extras.lodRef)
				{
					indices.lodRef = accessor.extras.lodRef;
				}

                return indices;
            },

            _getBufferViewData: function(bufferViewId)
            {
                var that = this;
                var header = that.gltfHeader;
                var bufferView = header.bufferViews[bufferViewId];

                var bufferData = that._bufferData[bufferView.buffer].content.slice(bufferView.byteOffset, bufferView.byteOffset + bufferView.byteLength);

                return bufferData;
            },

            _getBufferViewSubData: function(bufferViewId, offset, length)
            {
                var that = this;
                var header = that.gltfHeader;
                var bufferView = header.bufferViews[bufferViewId];

                var bufferData = that._bufferData[bufferView.buffer].content.slice(bufferView.byteOffset + offset, bufferView.byteOffset + offset + length);

                return bufferData;
            },

            //----------------------------------------------------------------------------------------------------------

            //----------------------------------------------------------------------------------------------------------

            /**
             * Returns the node's local volume
             * @returns {x3dom.fields.BoxVolume} the local, axis-aligned bounding volume
             */
            getVolume: function()
            {
                var vol = this._mesh._vol;
                var shapeNode;

                if (!vol.isValid())
                {
                    //an ExternalGeometry node must _always_ be a child of (at least) one shape node
                    //for multiple Shape nodes using a single ExternalGeometry node,
                    //we assume that either all of them, or no one have specified a bounding volume
                    shapeNode = this._parentNodes[0];

<<<<<<< Updated upstream
					if (self.headerBBoxSet)
					{
						vol.setBoundsByCenterSize(self.headerBBoxCenter, self.headerBBoxSize);
					} else {
                    	if (typeof shapeNode._vf["bboxCenter"] != 'undefined' &&
                        	typeof shapeNode._vf["bboxSize"]   != 'undefined')
                    	{
	                        vol.setBoundsByCenterSize(shapeNode._vf["bboxCenter"], shapeNode._vf["bboxSize"]);
	                    }
=======
                    if (typeof shapeNode._vf["bboxCenter"] != 'undefined' &&
                        typeof shapeNode._vf["bboxSize"]   != 'undefined' &&
						(shapeNode._vf["bboxSize"].toGL().filter(function(val) { return val < 0; }).length === 0)
						)
                    {
                        vol.setBoundsByCenterSize(shapeNode._vf["bboxCenter"], shapeNode._vf["bboxSize"]);
                    }
                    //if no bbox information was specified for the Shape node, use information from the SRC header
                    else
                    {

>>>>>>> Stashed changes
                    }
                }

                return vol;
            }

            //----------------------------------------------------------------------------------------------------------

            /*nodeChanged: function()
            {
                Array.forEach(this._parentNodes, function (node) {
                    node._dirty.positions = true;
                    node._dirty.normals = true;
                    node._dirty.texcoords = true;
                    node._dirty.colors = true;
                });
                this._vol.invalidate();
            },

            fieldChanged: function(fieldName)
            {
                if (fieldName == "index" ||fieldName == "coord" || fieldName == "normal" ||
                    fieldName == "texCoord" || fieldName == "color") {
                    this._dirty[fieldName] = true;
                    this._vol.invalidate();
                }
                else if (fieldName == "implicitMeshSize") {
                    this._vol.invalidate();
                }
            }*/

        }
    )
);


//----------------------------------------------------------------------------------------------------------------------
// PUBLIC STATIC FUNCTIONS
//----------------------------------------------------------------------------------------------------------------------



//----------------------------------------------------------------------------------------------------------------------

//----------------------------------------------------------------------------------------------------------------------
// PRIVATE STATIC FUNCTIONS
//----------------------------------------------------------------------------------------------------------------------

/**
 *
 * @param {STRING} type - accessor type, must be "SCALAR", "VEC2", "VEC3" or "VEC4"
 * @private
 */
x3dom.nodeTypes.ExternalGeometry._findNumComponentsForSRCAccessorType = function(type)
{
    switch (type)
    {
        case "SCALAR": return 1;
        case "VEC2":   return 2;
        case "VEC3":   return 3;
        case "VEC4":   return 4;
        default:       return 0;
    }
};

//----------------------------------------------------------------------------------------------------------------------

