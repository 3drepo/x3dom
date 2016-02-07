/** @namespace x3dom.nodeTypes */
/*
 * X3DOM JavaScript Library
 * http://www.x3dom.org
 *
 * (C)2016 3DRepo Ltd, London
 * Licensed under the MIT
 *
 * Author: Sebastian Friston
 */

// ### glTF ###
x3dom.registerNodeType(
    "glTF",
    "Networking",
    defineClass(x3dom.nodeTypes.X3DGroupingNode,

        /**
         * Constructor for glTF
         * @constructs x3dom.nodeTypes.glTF
         * @x3d 3.3
         * @component Networking
         * @status full
         * @extends x3dom.nodeTypes.X3DGroupingNode
         * @param {Object} [ctx=null] - context object, containing initial settings like namespace
         * @classdesc glTF is a Grouping node that hosts a glTF (https://github.com/KhronosGroup/glTF) scene description.
         * The scene graph described in the glTF header is instantiated as a set of X3DOM nodes.
         */
        function (ctx) {
            x3dom.nodeTypes.glTF.superClass.call(this, ctx);

            /**
             * Address of the glTF header file. This is the JSON that describes the scene hierarchy and the location of the
             * binary resources.
             * @var {x3dom.fields.MFString} url
             * @memberof x3dom.nodeTypes.glTF
             * @initvalue []
             * @field x3d
             * @instance
             */
            this.addField_MFString(ctx, 'url', []);
        },
        {
            nodeChanged: function ()
            {
                x3dom.debug.logInfo('nodeChanged glTF');
                if (!this.initDone) {
                    this._load();
                }
            },

            /**
             * Starts the download of the glTF header file defined in the url attribute of the node
             */
            _load: function ()
            {
                if (this._vf.url.length && this._vf.url[0].length) {

                    this.initDone = true;

                    x3dom.debug.logInfo('loading glTF');

                    var that = this;

                    var uri = this._nameSpace.getURL(this._vf.url[0]);

                    that._uri = uri;
                    that._path = uri.substr(0, uri.lastIndexOf('/') + 1);

                    //all resources in the gltf are now relative to the gltf path
                    //todo: check for side effects
                    this._nameSpace.setBaseURL(that._path);

                    //TODO: does this work for embedded (data:) uris?
                    this._nameSpace.doc.manageDownload(uri, "text/json", function(xhr) {
                        that._onceLoaded(xhr);
                    });
                }
            },

            /**
             * Parses the glTF header file and creates the scene graph. The scene graph is created by constructing
             * and X3D DOM using an XMLDocument, and then processing this as a new scene. The resulting x3d graph is
             * added as a child to this node.
             */
            _onceLoaded: function(xhr){

                var that = this;

                // set up the objects gltf specific properties
                that._gltf = {};
                that._gltf._header = JSON.parse(xhr.responseText);

                var header = that._gltf._header;

                // download all the requisite resources before scene setup can begin (i.e. shaders & textures)

                var downloads = [];

                for(shadername in header.shaders){
                    var shader = header.shaders[shadername];
                    var download = {
                        uri : that._nameSpace.getURL(shader.uri),
                        responseType : "text",
                        destination : shader
                    };
                    downloads.push(download);
                }

                this._nameSpace.doc.manageDownloads(downloads, function(){
                    that._setupScene();
                });
            },

            _setupScene: function(){

                var that = this;
                var header = this._gltf._header;

                // get the scene object - this will be the graph thats added to the dom
                var scene = header.scenes[header.scene];

                // create the scene dom in x3d
                var sceneDom = that._createSceneDOM(scene);

                //debug
                 var xmlString = (new XMLSerializer()).serializeToString(sceneDom);

                // create the scene graph and add it to the current graph
                var newScene = that._nameSpace.setupTree(sceneDom.documentElement);

                that.addChild(newScene);
                that.invalidateVolume();
                that._nameSpace.doc.needRender = true;
            },

            _createSceneDOM: function(scene){

                var that    = this;
                var header  = this._gltf._header;

                // create the xml document to hold the scene. Every node in the gltf scene graph (for now at least)
                // is a transform. gltf scene nodes have a 'meshes' property - these meshes will be added as child
                // Shape elements, under the Transform element, that is the scene node itself

                //todo: we could make this a scene node if we get the namespace setup right
                var sceneDoc = document.implementation.createDocument(null, "Transform");
                var sceneNode = sceneDoc.documentElement;

                // walk the scene graph (_createChild is recursive) to create x3d nodes
                scene.nodes.forEach(function(node) {
                    sceneNode.appendChild(that._createChild(sceneDoc, header.nodes[node]));
                });

                return sceneDoc;
            },

            _createChild: function(sceneDoc, gltfNode){

                var that    = this;
                var header  = this._gltf._header;

                // create a transform node to hold the mesh nodes and other child nodes. all gltf scene nodes are
                // Transforms

                var newNode = sceneDoc.createElement("Transform");

                //todo: configure the transform attributes with the transformations from the grpah

                // add any meshes of this node as as new glTFGeometry nodes
                if(gltfNode.meshes) {
                    gltfNode.meshes.forEach(function(mesh) {
                        newNode.appendChild(that._createShapeNode(sceneDoc, mesh));
                    });
                }

                // finally process all the children
                if(gltfNode.children) {
                    gltfNode.children.forEach(function(child) {
                        newNode.appendChild(that._createChild(sceneDoc, header.nodes[child]));
                    });
                }

                return newNode;
            },

            /*
             * Creates a new X3DShape node, with the geometry and appearance elements initialised to new glTFGeometry and
             * Appearance nodes.
             */
            _createShapeNode: function(sceneDoc, meshname){

                var that    = this;
                var header  = this._gltf._header;

                // create the shape node - this will render a primitive
                var shapeNode = sceneDoc.createElement("Shape");

                // create and apply the gltfgeometry node as the geometry part of the shape
                var geometryNode = sceneDoc.createElement("glTFGeometry");
                geometryNode.setAttribute("url", that._uri);
                geometryNode.setAttribute("mesh", meshname);
                //because the dom is being passed directly (not being encoded and parsed) we can pass objects
                geometryNode.gltfHeader = header;
                geometryNode.gltfHeaderBaseURI = that._path;

                shapeNode.appendChild(geometryNode);

                // create and apply the appearance node from the mesh material
                //todo: set the material

                var materialName = header.meshes[meshname].primitives[0].material;
                shapeNode.appendChild(that._createAppearanceNode(sceneDoc, materialName));

                return shapeNode;
            },

            _createAppearanceNode: function(sceneDoc, materialName){

                var that = this;
                var header  = this._gltf._header;

                var appearanceNode = sceneDoc.createElement("Appearance");

                var material = header.materials[materialName];

                if(material.technique){
                    appearanceNode.appendChild(that._createComposedShader(sceneDoc, material));
                }else{
                    // if there is no technique, use the x3dom equivalent of the gltf default technique (matte gray)
                    var materialNode = sceneDoc.createElement("Material");
                    materialNode.setAttribute("diffuseColor", "0.5 0.5 0.5");
                    appearanceNode.appendChild(materialNode);
                }

                return appearanceNode;
            },

            _createComposedShader: function(sceneDoc, material){

                var that = this;
                var header  = this._gltf._header;
                var technique = header.techniques[material.technique];
                var program = header.programs[technique.program];

                if(!program){
                    x3dom.debug.logError('glTF Technique must define a program');
                }

                var fragmentShader = header.shaders[program.fragmentShader];
                var vertexShader = header.shaders[program.vertexShader];

                if(!fragmentShader){
                    x3dom.debug.logError('glTF Programs must define both a fragment shader and vertex shader');
                }
                if(!vertexShader){
                    x3dom.debug.logError('glTF Programs must define both a fragment shader and vertex shader');
                }

                //._content member is set by manageDownloads which is invoked by the gltf node constructor above
                var fragmentShaderSource = fragmentShader._content;
                var vertexShaderSource = vertexShader._content;

                fragmentShaderSource = that._preprocessShader(fragmentShaderSource);
                vertexShaderSource = that._preprocessShader(vertexShaderSource);

                var composedShaderNode = sceneDoc.createElement("ComposedShader");

                // go through the uniforms list and find all the parameters defined in the material, in order to set
                // their values through field elements

                for(uniform in technique.uniforms){
                    var parametername = technique.uniforms[uniform];
                    var parameter = technique.parameters[parametername];

                    if(!parameter.semantic){
                        // if there is no semantic, it should be defined in the material
                        if(material.values[parametername]){
                            composedShaderNode.appendChild(that._createComposedShaderField(sceneDoc, uniform, parameter.type, material.values[parametername]));
                        } else {
                            x3dom.debug.logWarning("Technique contains parameters which will not be initialised.");
                        }
                    }
                }

                var vertexShaderPartNode = sceneDoc.createElement("ShaderPart");
                composedShaderNode.appendChild(vertexShaderPartNode);
                vertexShaderPartNode.setAttribute("type", "VERTEX");
                var vertexShaderContentNode = sceneDoc.createTextNode(vertexShaderSource);
                vertexShaderPartNode.appendChild(vertexShaderContentNode);

                var fragmentShaderPartNode = sceneDoc.createElement("ShaderPart");
                composedShaderNode.appendChild(fragmentShaderPartNode);
                fragmentShaderPartNode.setAttribute("type", "FRAGMENT");
                var fragmentShaderContentNode = sceneDoc.createTextNode(fragmentShaderSource);
                fragmentShaderPartNode.appendChild(fragmentShaderContentNode);

                return composedShaderNode;
            },

            /*
             * Preprocess the shader to make it conform to the x3d api
             */
            _preprocessShader: function(shaderSource)
            {
                String.prototype.replaceTokens = function(original, replacement)
                {
                    var that = this;
                    //http://regexr.com/
                    return that.replace(new RegExp("\b(" + original + "\b", 'g'), replacement);
                };

           //     shaderSource = shaderSource.replaceTokens("u_diffuse","diffuseColor");

                return shaderSource;
            },

            _createComposedShaderField: function(sceneDoc, uniformName, uniformType, uniformValue){

                var fieldnode = sceneDoc.createElement("field");

                fieldnode.setAttribute("name",uniformName);
                fieldnode.setAttribute("type", this._getX3DType(uniformType, uniformValue));
                fieldnode.setAttribute("value", uniformValue.toString());

                return fieldnode;
            },


            /*
             * Identify a suitable x3d type for x3dom to interpet the value as. This type should be such that
             * when sent to WebGL, it is of the type expected by the shader.
             * Use the mapping http://www.web3d.org/documents/specifications/19775-1/V3.2/Part01/shaders_glsl.html#Otherfields
             * to find which x3d types will 'serialise' to the desired GL type.
             * Ensure that not only are supported x3d types are returned (http://www.web3d.org/documents/specifications/19775-1/V3.2/Part01/fieldsDef.html#SFVec2dAndMFVec2d),
             * but that only the subset supported by the X3DNode addField_[] methods are returned (@X3DNode.js, ln 353)
             * See here for a list of all GL types that the user may request in the shader: https://gist.github.com/szimek/763999
             */
            _getX3DType: function(glType, x3dValue){

                switch (glType){
                    case WebGLRenderingContext.BOOL:
                        if(Array.isArray(x3dValue)){
                            return "MFBoolean";
                        }else{
                            return "SFBool";
                        }
                    // x3d does not have a concept of a vector of booleans, so send them as an array
                    case WebGLRenderingContext.BOOL_VEC2:
                        return "MFBoolean";
                    case WebGLRenderingContext.BOOL_VEC3:
                        return "MFBoolean";
                    case WebGLRenderingContext.BOOL_VEC4:
                        return "MFBoolean";

                    case WebGLRenderingContext.INT:
                        if(Array.isArray(x3dValue)){
                            return "MFInt32";
                        }else{
                            return "SFInt32";
                        }
                    case WebGLRenderingContext.INT_VEC2:
                        return "MFInt32";
                    case WebGLRenderingContext.INT_VEC3:
                        return "MFInt32";
                    case WebGLRenderingContext.INT_VEC4:
                        return "MFInt32";

                    case WebGLRenderingContext.FLOAT:
                        if(Array.isArray(x3dValue)){
                            return "MFFloat";
                        }else{
                            return "SFFloat";
                        }
                    case WebGLRenderingContext.FLOAT_VEC2:
                        if(Array.isArray(x3dValue)){
                            return "MFVec2f";
                        }else{
                            return "SFVec2f";
                        }
                    case WebGLRenderingContext.FLOAT_VEC3:
                        if(Array.isArray(x3dValue)){
                            return "MFVec3f";
                        }else{
                            return "SFVec3f";
                        }
                    case WebGLRenderingContext.FLOAT_VEC4:
                        if(Array.isArray(x3dValue)){
                            return "MFFloat";
                        }else{
                            return "MFFloat";
                        }

                    case WebGLRenderingContext.FLOAT_MAT2:
                        return "MFFloat";
                    case WebGLRenderingContext.FLOAT_MAT3:
                        if(Array.isArray(x3dValue)){
                            return "MFFloat";
                        }else{
                            return "MFFloat";
                        }
                    case WebGLRenderingContext.FLOAT_MAT4:
                        if(Array.isArray(x3dValue)){
                            return "MFFloat";
                        }else{
                            return "SFMatrix4f";
                        }
                }


            }
        }
    )
);