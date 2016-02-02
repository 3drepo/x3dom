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

            //caches the gltf buffers
            this._bufferData = {};

            this._bufferViewGLBuffers = {};

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
                shape._webgl.internalDownloadCount  = 1;
                shape._nameSpace.doc.downloadCount  = 1;

                //TODO: check this object - when is it called, where is it really needed?
                //shape._webgl.makeSeparateTris = {...};

            },

            //----------------------------------------------------------------------------------------------------------

            //----------------------------------------------------------------------------------------------------------
            // PRIVATE FUNCTIONS
            //----------------------------------------------------------------------------------------------------------

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
                //todo: x3d rendering path only supports one material per set of primitives, so the splitting of the
                //primitives needs to be done in the glTF node, and an index passed for here.
                this._updateRenderDataForPrimitive(shape, shaderProgram, gl, requestedMesh.primitives[0]);
            },

            _updateRenderDataForPrimitive: function(shape, shaderProgram, gl, requestedPrimitive){

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
                }

                var shaderParameters = [
                    shaderParameterCtor(POSITION_BUFFER_IDX, "POSITION", "coord", "Pos"),
                    shaderParameterCtor(NORMAL_BUFFER_IDX, "NORMAL", "normal", "Norm"),
                    shaderParameterCtor(TEXCOORD_BUFFER_IDX, "TEXCOORD_0", "texCoord", "Tex"),
                    shaderParameterCtor(COLOR_BUFFER_IDX, "COLOR", "color", "col"),
                    shaderParameterCtor(ID_BUFFER_IDX, "ID", "id", "Id")
                ];

                shaderParameters.forEach(function(attribute)
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

                if(primitive.attributes[shaderParameters[0].Name]){
                    var positionView = that._getAccessorView(primitive.attributes[shaderParameters[0].Name], gl);
                    this._mesh._numCoords += positionView.elementCount;
                }

                if(primitive.attributes[shaderParameters[4].Name]){
                    shape._cf.geometry.node._vf.idsPerVertex = true;
                }


                // 6. notify renderer

                shape._dirty.shader = true;
                shape._nameSpace.doc.needRender = true;

                x3dom.BinaryContainerLoader.checkError(gl);

            },

            //----------------------------------------------------------------------------------------------------------
            // HELPER FUNCTIONS
            //----------------------------------------------------------------------------------------------------------

            _downloadBuffers: function(callback){

                var that = this;
                that._bufferDownloadCompleteCallback = callback;

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
            },

            _onceDownloadedBuffer: function(xhr, buffer){

                var that = this;

                buffer.done = true;
                if(xhr.status === 200 || xhr.status === 0)
                {
                    buffer.content = new Uint8Array(xhr.response, 0, xhr.byteLength);
                }

                var finished = true;
                for(bufferId in that._bufferData)
                {
                    if(that._bufferData[bufferId].done != true){
                        finished = false;
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

                    if (typeof shapeNode._vf["bboxCenter"] != 'undefined' &&
                        typeof shapeNode._vf["bboxSize"]   != 'undefined'   )
                    {
                        vol.setBoundsByCenterSize(shapeNode._vf["bboxCenter"], shapeNode._vf["bboxSize"]);
                    }
                    //if no bbox information was specified for the Shape node, use information from the SRC header
                    else
                    {
                        //TODO: implement
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
