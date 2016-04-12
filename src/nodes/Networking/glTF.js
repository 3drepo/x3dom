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
			
			this.partitioning = undefined;
			
			this.geometryNodes = [];
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
                    this._nameSpace.doc.manageDownload(uri, "text", function(xhr) {
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
                // the response will be placed in the _content member of the object provided as 'destination'

                var downloads = [];

                for(shadername in header.shaders){
                    var shader = header.shaders[shadername];
                    var download = {
                        uri : that._nameSpace.getURL(shader.uri),
                        responseType : "text",
                        destination : shader
                    };
                    downloads.push(download);

                    if(shader.extras)
                    {
                        if(shader.extras.x3domShaderFunction)
                        {
                            var x3domShader = shader.extras.x3domShaderFunction;
                            var download = {
                                uri : that._nameSpace.getURL(x3domShader.uri),
                                responseType : "text",
                                destination : x3domShader
                            };
                            downloads.push(download);
                        }
                    }
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

				that._getPartitioningInfo(scene);

                //debug
                // var xmlString = (new XMLSerializer()).serializeToString(sceneDom);

                // create the scene graph and add it to the current graph
                var newScene = that._nameSpace.setupTree(sceneDom.documentElement);

                that.addChild(newScene);
                that.invalidateVolume();
                that._nameSpace.doc.needRender = true;
            },

			_getPartitioningInfo: function(scene) {
				var that = this;
				var partitionContent = {};
								
				if (scene.hasOwnProperty("extras"))
				{
					if (scene.extras.hasOwnProperty("partitioning"))
					{
						var uri = scene.extras.partitioning.uri;
								
						var download = [{
							uri: uri,
							responseType: "text",
							destination: partitionContent
						}];
						
						this._nameSpace.doc.manageDownloads(download, function() {
							that.partitioning = JSON.parse(partitionContent._content);
							
							// Compute bounding boxes for meshes in the tree
							var partitioningStack = [{
								treePointer: that.partitioning
							}];
							
							while(partitioningStack.length)
							{
								var currentProcessing = partitioningStack.splice(0,1)[0];
								
								if (currentProcessing.treePointer.hasOwnProperty("meshes"))
								{
									var currentMeshes = currentProcessing.treePointer.meshes;
									
									for(var meshID in currentMeshes)
									{
										if (currentMeshes.hasOwnProperty(meshID))
										{
											var min = new x3dom.fields.SFVec3f(currentMeshes[meshID].min[0], currentMeshes[meshID].min[1], currentMeshes[meshID].min[2]);
											var max = new x3dom.fields.SFVec3f(currentMeshes[meshID].max[0], currentMeshes[meshID].max[1], currentMeshes[meshID].max[2]); 
											
											currentMeshes[meshID].bbox = new x3dom.fields.BoxVolume(min, max);
										}
									}
								} else {
									partitioningStack.push({
										treePointer: currentProcessing.treePointer.left
									});
									
									partitioningStack.push({
										treePointer: currentProcessing.treePointer.right
									});									
								}
							}
						});
					}
				}
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

                var context = {};

                // walk the scene graph (_createChild is recursive) to create x3d nodes
                scene.nodes.forEach(function(node) {
                    sceneNode.appendChild(that._createChild(sceneDoc, header.nodes[node], context));
                });

                return sceneDoc;
            },

            _createChild: function(sceneDoc, gltfNode, context){

                var that    = this;
                var header  = this._gltf._header;

                // create a transform node to hold the mesh nodes and other child nodes. all gltf scene nodes are
                // Transforms

                var newNode = sceneDoc.createElement("Transform");

                if(gltfNode.matrix)
                {
                    //the transform is supplied as a matrix, so use a MatrixTransform instead of a Transform node
                    newNode = sceneDoc.createElement("MatrixTransform");
                    newNode.setAttribute("matrix",gltfNode.matrix.toString());
                }

                // add any meshes of this node as as new glTFGeometry nodes
                if(gltfNode.meshes) {
                    gltfNode.meshes.forEach(function(mesh) {
                        newNode.appendChild(that._createShapeNode(sceneDoc, mesh, context));
                    });
                }

                // finally process all the children
                if(gltfNode.children) {
                    gltfNode.children.forEach(function(child) {
                        newNode.appendChild(that._createChild(sceneDoc, header.nodes[child], context));
                    });
                }

                return newNode;
            },

            /*
             * Creates a new X3DShape node, with the geometry and appearance elements initialised to new glTFGeometry and
             * Appearance nodes.
             */
            _createShapeNode: function(sceneDoc, meshname, context){

                var that    = this;
                var header  = this._gltf._header;

                // create the shape node - this will render a primitive
                var shapeNode = sceneDoc.createElement("Shape");

                // create and apply the gltfgeometry node as the geometry part of the shape
				
                geometryNode = sceneDoc.createElement("glTFGeometry");
                geometryNode.setAttribute("url", that._uri);
                geometryNode.setAttribute("mesh", meshname);
                geometryNode.setAttribute("DEF", meshname);
                //because the dom is being passed directly (not being encoded and parsed) we can pass objects
                geometryNode.gltfHeader = header;
                geometryNode.gltfHeaderBaseURI = that._path;

                shapeNode.appendChild(geometryNode);
				
				this.geometryNodes.push(geometryNode);

                // check if this is the start of a multipart subgraph. if so, put the subgrpah we just created inside a
                // Multipart element, and build an idmap to send with it via the DOM
                var multipart = header.meshes[meshname].primitives[0].attributes["IDMAP"] != undefined;
                if(multipart)
                {
                    //this is a multipart mesh, so make the shape node an inline scene of a multipart element
                    //this has to be set in the xml (rather than the x3d graph) so that the VERTEX_ID flag will
                    //be set by the generateProperties method of Utils.js
                    geometryNode.setAttribute("isMultipart","true");
                    geometryNode.setAttribute("idsPerVertex","true");

                    //need an appearance node to which the common surface shader is added
                    shapeNode.appendChild(sceneDoc.createElement("Appearance"));

                    //place the shape node inside a multipart node, with a generated idmap
                    var multipartNode = sceneDoc.createElement("Multipart");
                    multipartNode.setAttribute("url","");
                    multipartNode.setAttribute("urlIDMap","");
                    multipartNode._idMap = {
                        "numberOfIDs" : 0,
                        "maxGeoCount" : 0,
                        "mapping"     : [],
                        "appearance"  : []
                    };
                    that._addMeshToIdMap(meshname, multipartNode._idMap);
                    multipartNode._inlScene = shapeNode;
                    		
                    multipartNode.onclick = this._xmlNode.onclick;

                    shapeNode = multipartNode;
                }
                else // there is nothing wrong with creating the material below, but why waste the time if we know we don't have to?
                {
                    // create and apply the appearance node from the mesh material
                    //todo: set the material

                    var materialName = header.meshes[meshname].primitives[0].material;
                    shapeNode.appendChild(that._createAppearanceNode(sceneDoc, materialName));
                }

                return shapeNode;
            },

            _addMeshToIdMap: function(meshName, idmap)
            {
                var that    = this;
                var header  = this._gltf._header;

                var mesh = header.meshes[meshName];

                idmap.maxGeoCount++;
                idmap.numberOfIDs += mesh.primitives.length;

                for(var i = 0; i < mesh.primitives.length; i++)
                {
                    var primitive = mesh.primitives[i];

                    var positionsAccessor = header.accessors[primitive.attributes["POSITION"]];

                    var submesh = {
                        "appearance" : primitive.material,
                        "min" : positionsAccessor.min.toString(),
                        "max" : positionsAccessor.max.toString(),
                        "name" : (primitive.extras ? primitive.extras.refID : undefined),
                        "usage" : [ meshName ]
                    }

                    if(primitive.extras)
                    {
                        if(primitive.extras.refID){
                            submesh.name = primitive.extras.refID;
                        }
                    }

                    idmap.mapping.push(submesh);
                }

                for(var materialname in header.materials)
                {
                    idmap.appearance.push(
                        {
                            "name" : materialname,
                            "material" : header.materials[materialname].extras.x3dmaterial
                        }
                    );
                }
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

                var fragmentShaderSource = fragmentShader._content;
                var vertexShaderSource = vertexShader._content;

                if (fragmentShader.extras) {
                    if (fragmentShader.extras.x3domShaderFunction) {
                        fragmentShaderSource = that._buildSingleShader(fragmentShader.extras.x3domShaderFunction, technique);
                    }
                }

                if (vertexShader.extras) {
                    if (vertexShader.extras.x3domShaderFunction) {
                        vertexShaderSource = that._buildSingleShader(vertexShader.extras.x3domShaderFunction, technique);
                    }
                }

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

            _createComposedShaderField: function(sceneDoc, uniformName, uniformType, uniformValue){

                var fieldnode = sceneDoc.createElement("field");

                fieldnode.setAttribute("name",uniformName);
                fieldnode.setAttribute("type", this._getX3DType(uniformType, uniformValue));
                fieldnode.setAttribute("value", uniformValue.toString());

                return fieldnode;
            },

            /* Wraps the function specified in the shaderFunction object in a shader suitable for shading a typical mesh.
             * This will use the uniforms/attributes/parameters objects of the gltf header along with shaderSource to
             * build the shader. */
            _buildSingleShader: function(shaderFunction, technique)
            {
                var that = this;
                var header  = this._gltf._header;

                var parameters = technique.parameters;
                var attributes = technique.attributes;
                var uniforms = technique.uniforms;
                var varyings = technique.extras.varyings; //must be present even if there are none

                var functionParameters = shaderFunction.parameters;

                var source = "";

                //define the headers
                source += "#define X3DOM" + '\n';
                source += "precision highp float;" + '\n';

                //write the attributes
                for(var varname in attributes)
                {
                    if(functionParameters.indexOf(varname) >= 0) {
                        source += "attribute " + that._getGLSLType(parameters[attributes[varname]].type) + " " + varname + ";\n";
                    }
                }

                //write the uniforms
                for(var varname in uniforms)
                {
                    if(functionParameters.indexOf(varname) >= 0) {
                        source += "uniform " + that._getGLSLType(parameters[uniforms[varname]].type) + " " + varname + ";\n";
                    }
                }

                //write the varyings
                for(var varname in varyings)
                {
                    if(functionParameters.indexOf(varname) >= 0) {
                        source += "varying " + that._getGLSLType(varyings[varname].type) + " " + varname + ";\n";
                    }
                }

                source += "\n\n";
                //write the main function...

                var main = "";

                main += "void main(){\n";

                var functionCall = "";
                functionCall += shaderFunction.name + "(";
                for(var i = 0; i < functionParameters.length; i++)
                {
                    functionCall += functionParameters[i];
                    if(i < functionParameters.length - 1){
                        functionCall += ",";
                    }
                }
                functionCall += ");";

                main += shaderFunction.returns + " = " + functionCall + "\n";

                main += "}\n";

                //finally put it together

                source += shaderFunction._content + "\n\n";

                source += main;

                return source;
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
            },

            /*
             * Identify the equivalent GLSL type name for the type enumeration. These are defined in the GLSL language
             * spec (e.g. http://oss.sgi.com/projects/ogl-sample/registry/ARB/GLSLangSpec.Full.1.10.59.pdf)
             */
            //todo: are these not defined elsewhere as part of webgl??
            _getGLSLType: function(glType){

                switch (glType){
                    case WebGLRenderingContext.BOOL:
                        return "bool";
                    case WebGLRenderingContext.BOOL_VEC2:
                        return "bvec2";
                    case WebGLRenderingContext.BOOL_VEC3:
                        return "bvec3";
                    case WebGLRenderingContext.BOOL_VEC4:
                        return "bvec4";
                    case WebGLRenderingContext.INT:
                        return "int";
                    case WebGLRenderingContext.INT_VEC2:
                        return "ivec2";
                    case WebGLRenderingContext.INT_VEC3:
                        return "ivec3";
                    case WebGLRenderingContext.INT_VEC4:
                        return "ivec4";
                    case WebGLRenderingContext.FLOAT:
                        return "float";
                    case WebGLRenderingContext.FLOAT_VEC2:
                        return "vec2";
                    case WebGLRenderingContext.FLOAT_VEC3:
                        return "vec3";
                    case WebGLRenderingContext.FLOAT_VEC4:
                        return "vec4";
                    case WebGLRenderingContext.FLOAT_MAT2:
                        return "mat2";
                    case WebGLRenderingContext.FLOAT_MAT3:
                        return "mat3";
                    case WebGLRenderingContext.FLOAT_MAT4:
                        return "mat4";
                }
            },
			
			collectDrawableObjects: function (transform, drawableCollection, singlePath, invalidateCache, planeMask, clipPlanes)
            {
				var that = this;
				
				if (this.partitioning)
				{
					var originalBoundingBox = this.graphState().worldVolume;
					var treeStack = [{
						treePointer: this.partitioning,
						bbox: originalBoundingBox
					}]; // Stack containing parts of the tree ready to process
				
					var _setAxisValue = function(axis, vec, value)
					{
						if (axis === "X") { vec.x = value; }
						else if (axis === "Y") { vec.y = value; }
						else if (axis === "Z") { vec.z = value; }
					};
					
					var visibleMeshes = {};
					
					var start = new Date().getTime();
					
					// Loop through the children elements and cull those from the
					// multipart generation
					while(treeStack.length)
					{
						var currentProcessing = treeStack.splice(0,1)[0];
						
						if (currentProcessing.treePointer.hasOwnProperty("meshes"))
						{
							var currentVisibleMeshes = currentProcessing.treePointer.meshes;
							
							for (var meshID in currentVisibleMeshes)
							{
								if (!visibleMeshes.hasOwnProperty(meshID) && currentVisibleMeshes.hasOwnProperty(meshID))
								{
									visibleMeshes[meshID] = currentVisibleMeshes[meshID];
								}
							} 

						} else {
							// Process the left branch
							// First construct the bounding volume containing the left side
							var leftMin    = currentProcessing.bbox.min.copy();
							var leftMax    = currentProcessing.bbox.max.copy();
							
							_setAxisValue(currentProcessing.treePointer.axis, leftMax, currentProcessing.treePointer.value);
							
							var leftVolume = new x3dom.fields.BoxVolume(leftMin, leftMax);	
							
							// Create a fake graphState
							var leftPlaneMask = drawableCollection.cull(transform, {
								needCulling: true,
								worldVolume: new x3dom.fields.BoxVolume(),
								boundedNode : {
									_vf : { render: true },
									getVolume: function() { return leftVolume; }
								}
							}, singlePath, planeMask);
							
							if (leftPlaneMask >= 0)
							{
								treeStack.push({
									treePointer: currentProcessing.treePointer.left,
									bbox: leftVolume
								});
							} 
							
							// Process the right branch
							// First construct the bounding volume containing the right side
							var rightMin    = currentProcessing.bbox.min.copy();
							var rightMax    = currentProcessing.bbox.max.copy();
							
							_setAxisValue(currentProcessing.treePointer.axis, rightMin, currentProcessing.treePointer.value);
							
							var rightVolume = new x3dom.fields.BoxVolume(rightMin, rightMax);	
							
							// Create a fake graphState
							var rightPlaneMask = drawableCollection.cull(transform, {
								needCulling: true,
								worldVolume: new x3dom.fields.BoxVolume(),
								boundedNode : {
									_vf : { render: true },
									getVolume: function() { return rightVolume; }
								}
							}, singlePath, planeMask);
							
							if (rightPlaneMask >= 0)
							{
								treeStack.push({
									treePointer: currentProcessing.treePointer.right,
									bbox: rightVolume
								});
							} 											
						}					
					}
					
					// Refined mesh culling
					for(var meshID in visibleMeshes)
					{
						if (visibleMeshes.hasOwnProperty(meshID))
						{
							var subMeshPlaneMask = drawableCollection.cull(transform, {
								needCulling: true,
								worldVolume: new x3dom.fields.BoxVolume(),
								boundedNode : {
									_vf : { render: true },
									getVolume: function() { return visibleMeshes[meshID].bbox; }
								}
							}, singlePath, planeMask);	
						
							if (subMeshPlaneMask < 0)
							{
								delete visibleMeshes[meshID];
							}
						}				
					}
					
					var end = new Date().getTime();
					var time = end - start;
					//console.log('Execution time: ' + time);
					//console.log("LEN: " + Object.keys(visibleMeshes).length);
					
					for(var i = 0; i < this.geometryNodes.length; i++)
					{
						this.geometryNodes[i]._x3domNode.changeVisibility(Object.keys(visibleMeshes));
					}
				}
				
                // check if multi parent sub-graph, don't cache in that case
                if (singlePath && (this._parentNodes.length > 1))
                    singlePath = false;

                // an invalid world matrix or volume needs to be invalidated down the hierarchy
                if (singlePath && (invalidateCache = invalidateCache || this.cacheInvalid()))
                    this.invalidateCache();

                // check if sub-graph can be culled away or render flag was set to false
                planeMask = drawableCollection.cull(transform, this.graphState(), singlePath, planeMask);
                if (planeMask < 0) {
                    return;
                }

                var cnode, childTransform;

                if (singlePath) {
                    // rebuild cache on change and reuse world transform
                    if (!this._graph.globalMatrix) {
                        this._graph.globalMatrix = this.transformMatrix(transform);
                    }
                    childTransform = this._graph.globalMatrix;
                }
                else {
                    childTransform = this.transformMatrix(transform);
                }

                var n = this._childNodes.length;

                if (x3dom.nodeTypes.ClipPlane.count > 0) {
                    var localClipPlanes = [];

                    for (var j = 0; j < n; j++) {
                        if ( (cnode = this._childNodes[j]) ) {
                            if (x3dom.isa(cnode, x3dom.nodeTypes.ClipPlane) && cnode._vf.on && cnode._vf.enabled) {
                                localClipPlanes.push({plane: cnode, trafo: childTransform});
                            }
                        }
                    }

                    clipPlanes = localClipPlanes.concat(clipPlanes);
                }

                for (var i=0; i<n; i++) {
                    if ( (cnode = this._childNodes[i]) ) {
                        cnode.collectDrawableObjects(childTransform, drawableCollection, singlePath, invalidateCache, planeMask, clipPlanes);
                    }
                }
            }
        }
    )
);