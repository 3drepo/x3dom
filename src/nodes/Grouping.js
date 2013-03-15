/*
 * X3DOM JavaScript Library
 * http://www.x3dom.org
 *
 * (C)2009 Fraunhofer IGD, Darmstadt, Germany
 * Dual licensed under the MIT and GPL
 *
 * Based on code originally provided by
 * Philip Taylor: http://philip.html5.org
 */

// ### X3DGroupingNode ###
x3dom.registerNodeType(
    "X3DGroupingNode",
    "Grouping",
    defineClass(x3dom.nodeTypes.X3DChildNode,
        function (ctx) {
            x3dom.nodeTypes.X3DGroupingNode.superClass.call(this, ctx);

            this.addField_SFBool(ctx, 'render', true);
            this.addField_MFNode('children', x3dom.nodeTypes.X3DChildNode);
            // FIXME; add addChild and removeChild slots ?
        },
        {
            // Collects array of [transform matrix, node] for all objects that should be drawn.
            collectDrawableObjects: function (transform, out)
            {
                if (!this._vf.render || !out) {
                    return;
                }

                for (var i=0; i<this._childNodes.length; i++) {
                    if (this._childNodes[i]) {
                        var childTransform = this._childNodes[i].transformMatrix(transform);
                        this._childNodes[i].collectDrawableObjects(childTransform, out);
                    }
                }
            }
        }
    )
);

// ### Switch ###
x3dom.registerNodeType(
    "Switch",
    "Grouping",
    defineClass(x3dom.nodeTypes.X3DGroupingNode,
        function (ctx) {
            x3dom.nodeTypes.Switch.superClass.call(this, ctx);

            this.addField_SFInt32(ctx, 'whichChoice', -1);
        },
        {
            getVolume: function (min, max, invalidate)
            {
                if (this._vf.whichChoice < 0 ||
                    this._vf.whichChoice >= this._childNodes.length) {
                    return false;
                }

                if (this._childNodes[this._vf.whichChoice]) {
                    return this._childNodes[this._vf.whichChoice].getVolume(min, max, invalidate);
                }

                return false;
            },

            find: function (type)
            {
                if (this._vf.whichChoice < 0 ||
                    this._vf.whichChoice >= this._childNodes.length) {
                    return null;
                }

                if (this._childNodes[this._vf.whichChoice]) {
                    if (this._childNodes[this._vf.whichChoice].constructor == type) {
                        return this._childNodes[this._vf.whichChoice];
                    }

                    var c = this._childNodes[this._vf.whichChoice].find(type);
                    if (c) {
                        return c;
                    }
                }

                return null;
            },

            findAll: function (type)
            {
                if (this._vf.whichChoice < 0 ||
                    this._vf.whichChoice >= this._childNodes.length) {
                    return [];
                }

                var found = [];

                if (this._childNodes[this._vf.whichChoice]) {
                    if (this._childNodes[this._vf.whichChoice].constructor == type) {
                        found.push(this._childNodes[this._vf.whichChoice]);
                    }

                    found = found.concat(this._childNodes[this._vf.whichChoice].findAll(type));
                }

                return found;
            },

            // Collects array of [transform matrix, node] for all objects that should be drawn.
            collectDrawableObjects: function (transform, out)
            {
                if (!out || this._vf.whichChoice < 0 ||
                    this._vf.whichChoice >= this._childNodes.length) {
                    return;
                }

                if (this._childNodes[this._vf.whichChoice]) {
                    var childTransform = this._childNodes[this._vf.whichChoice].transformMatrix(transform);
                    this._childNodes[this._vf.whichChoice].collectDrawableObjects(childTransform, out);
                }
            },

            doIntersect: function(line)
            {
                if (this._vf.whichChoice < 0 ||
                    this._vf.whichChoice >= this._childNodes.length) {
                    return false;
                }

                if (this._childNodes[this._vf.whichChoice]) {
                    return this._childNodes[this._vf.whichChoice].doIntersect(line);
                }

                return false;
            }
        }
    )
);

// ### X3DTransformNode ###
x3dom.registerNodeType(
    "X3DTransformNode",
    "Grouping",
    defineClass(x3dom.nodeTypes.X3DGroupingNode,
        function (ctx) {
            x3dom.nodeTypes.X3DTransformNode.superClass.call(this, ctx);

            if (ctx)
                ctx.doc._nodeBag.trans.push(this);
            else
                x3dom.debug.logWarning("X3DTransformNode: No runtime context found!");

            // holds the current matrix (local space transform)
            this._trafo = null;
        },
        {
            tick: function(t)
            {
              if( this._xmlNode && (
                    this._xmlNode['transform'] ||
                    this._xmlNode.hasAttribute('transform') ||
                    this._listeners['transform'])
              )
              {
                var transMatrix = this.getCurrentTransform();
                
                var event = {
                  target: {},
                  type: 'transform',
                  worldX: transMatrix._03,
                  worldY: transMatrix._13,
                  worldZ: transMatrix._23,
                  stopPropagation: function() { this.cancelBubble = true; }
                };
                
                var attrib = this._xmlNode[event.type];
                
                if (typeof(attrib) === "function")
                  attrib.call(this._xmlNode, event);
                else
                {
                  var funcStr = this._xmlNode.getAttribute(event.type);
                  var func = new Function('event', funcStr);
                  func.call(this._xmlNode, event);
                }

                var list = this._listeners[event.type];
                if (list)
                  for (var it=0; it<list.length; it++)
                    list[it].call(this._xmlNode, event);
              }
              
              // temporary per frame update method for CSS-Transform
              var trans = x3dom.getStyle(this._xmlNode, "-webkit-transform");
              //x3dom.debug.logInfo('set css-trans: ' + this._DEF + ' to ' + trans);
              if (trans && (trans != 'none')) {
                  this._trafo.setValueByStr(trans);
                  //x3dom.debug.logInfo(' valid set:' + this._trafo);
                  return true;
              }

              return false;
            },

            transformMatrix: function(transform) {
                return transform.mult(this._trafo);
            },

            getVolume: function(min, max, invalidate)
            {
                var nMin = x3dom.fields.SFVec3f.MAX();
                var nMax = x3dom.fields.SFVec3f.MIN();
                var valid = false;

                for (var i=0, n=this._childNodes.length; i<n; i++)
                {
                    if (this._childNodes[i])
                    {
                        var childMin = x3dom.fields.SFVec3f.MAX();
                        var childMax = x3dom.fields.SFVec3f.MIN();

                        valid = this._childNodes[i].getVolume(
                                        childMin, childMax, invalidate) || valid;

                        if (valid)  // values only set by Mesh.BBox()
                        {
                            if (nMin.x > childMin.x) {nMin.x = childMin.x;}
                            if (nMin.y > childMin.y) {nMin.y = childMin.y;}
                            if (nMin.z > childMin.z) {nMin.z = childMin.z;}

                            if (nMax.x < childMax.x) {nMax.x = childMax.x;}
                            if (nMax.y < childMax.y) {nMax.y = childMax.y;}
                            if (nMax.z < childMax.z) {nMax.z = childMax.z;}
                        }
                    }
                }

                if (valid)
                {
                    nMin = this._trafo.multMatrixPnt(nMin);
                    nMax = this._trafo.multMatrixPnt(nMax);

                    min.x = nMin.x < nMax.x ? nMin.x : nMax.x;
                    min.y = nMin.y < nMax.y ? nMin.y : nMax.y;
                    min.z = nMin.z < nMax.z ? nMin.z : nMax.z;

                    max.x = nMax.x > nMin.x ? nMax.x : nMin.x;
                    max.y = nMax.y > nMin.y ? nMax.y : nMin.y;
                    max.z = nMax.z > nMin.z ? nMax.z : nMin.z;
                }
                return valid;
            },

            doIntersect: function(line)
            {
                var isect = false;
                var mat = this._trafo.inverse();

                var tmpPos = new x3dom.fields.SFVec3f(line.pos.x, line.pos.y, line.pos.z);
                var tmpDir = new x3dom.fields.SFVec3f(line.dir.x, line.dir.y, line.dir.z);

                line.pos = mat.multMatrixPnt(line.pos);
                line.dir = mat.multMatrixVec(line.dir);

                if (line.hitObject) {
                    line.dist *= line.dir.length();
                }

                // check for _nearest_ hit object and don't stop on first!
                for (var i=0; i<this._childNodes.length; i++)
                {
                    if (this._childNodes[i]) {
                        isect = this._childNodes[i].doIntersect(line) || isect;
                    }
                }

                line.pos.setValues(tmpPos);
                line.dir.setValues(tmpDir);

                if (isect) {
                    line.hitPoint = this._trafo.multMatrixPnt(line.hitPoint);
                    line.dist *= line.dir.length();
                }

                return isect;
            },

            parentRemoved: function(parent)
            {
                var i, n;
                
                if (this._parentNodes.length === 0) {
                    var doc = this.findX3DDoc();

                    for (i=0, n=doc._nodeBag.trans.length; i<n; i++) {
                        if (doc._nodeBag.trans[i] === this) {
                            doc._nodeBag.trans.splice(i, 1);
                        }
                    }
                }

                for (i=0, n=this._childNodes.length; i<n; i++) {
                    if (this._childNodes[i]) {
                        this._childNodes[i].parentRemoved(this);
                    }
                }
            }
        }
    )
);

// ### Transform ###
x3dom.registerNodeType(
    "Transform",
    "Grouping",
    defineClass(x3dom.nodeTypes.X3DTransformNode,
        function (ctx) {
            x3dom.nodeTypes.Transform.superClass.call(this, ctx);

            this.addField_SFVec3f(ctx, 'center', 0, 0, 0);
            this.addField_SFVec3f(ctx, 'translation', 0, 0, 0);
            this.addField_SFRotation(ctx, 'rotation', 0, 0, 1, 0);
            this.addField_SFVec3f(ctx, 'scale', 1, 1, 1);
            this.addField_SFRotation(ctx, 'scaleOrientation', 0, 0, 1, 0);

            // P' = T * C * R * SR * S * -SR * -C * P
            this._trafo = x3dom.fields.SFMatrix4f.translation(
                    this._vf.translation.add(this._vf.center)).
                mult(this._vf.rotation.toMatrix()).
                mult(this._vf.scaleOrientation.toMatrix()).
                mult(x3dom.fields.SFMatrix4f.scale(this._vf.scale)).
                mult(this._vf.scaleOrientation.toMatrix().inverse()).
                mult(x3dom.fields.SFMatrix4f.translation(this._vf.center.negate()));
        },
        {
            fieldChanged: function (fieldName) {
                // P' = T * C * R * SR * S * -SR * -C * P
                this._trafo = x3dom.fields.SFMatrix4f.translation(
                                this._vf.translation.add(this._vf.center)).
                            mult(this._vf.rotation.toMatrix()).
                            mult(this._vf.scaleOrientation.toMatrix()).
                            mult(x3dom.fields.SFMatrix4f.scale(this._vf.scale)).
                            mult(this._vf.scaleOrientation.toMatrix().inverse()).
                            mult(x3dom.fields.SFMatrix4f.translation(this._vf.center.negate()));
            }
        }
    )
);

// ### MatrixTransform ###
x3dom.registerNodeType(
    "MatrixTransform",
    "Grouping",
    defineClass(x3dom.nodeTypes.X3DTransformNode,
        function (ctx) {
            x3dom.nodeTypes.MatrixTransform.superClass.call(this, ctx);

            this.addField_SFMatrix4f(ctx, 'matrix', 1, 0, 0, 0,
                                                    0, 1, 0, 0,
                                                    0, 0, 1, 0,
                                                    0, 0, 0, 1);
            this._trafo = this._vf.matrix.transpose();
        },
        {
            fieldChanged: function (fieldName) {
                this._trafo = this._vf.matrix.transpose();
            }
        }
    )
);

// ### Group ###
x3dom.registerNodeType(
    "Group",
    "Grouping",
    defineClass(x3dom.nodeTypes.X3DGroupingNode,
        function (ctx) {
            x3dom.nodeTypes.Group.superClass.call(this, ctx);
        },
        {
        }
    )
);

// ### StaticGroup ###
x3dom.registerNodeType(
    "StaticGroup",
    "Grouping",
    defineClass(x3dom.nodeTypes.X3DGroupingNode,
        function (ctx) {
            x3dom.nodeTypes.StaticGroup.superClass.call(this, ctx);

            // FIXME; implement optimizations; no need to maintain the children's
            // X3D representations, as they cannot be accessed after creation time
            x3dom.debug.logWarning("StaticGroup NYI");
        }
    )
);

// ### RemoteSelectionGroup ###
x3dom.registerNodeType(
    "RemoteSelectionGroup",
    "Grouping",
    defineClass(x3dom.nodeTypes.X3DGroupingNode,
        function (ctx) {
            x3dom.nodeTypes.RemoteSelectionGroup.superClass.call(this, ctx);

            this.addField_MFString(ctx, 'url', ["ws://localhost:35668/cstreams/0"]);  // address for WebSocket connection
            this.addField_MFString(ctx, 'label', []);           // list for subsequent id/object pairs
            this.addField_SFInt32(ctx, 'maxRenderedIds', -1);   // max number of items to be rendered
            this.addField_SFBool(ctx, 'reconnect', true);       // if true, the node tries to reconnect
            this.addField_SFFloat(ctx, 'scaleRenderedIdsOnMove', 1.0);  // scaling factor to reduce render calls during navigation (between 0 and 1)
            this.addField_SFBool(ctx, 'enableCulling', true);   // if false, RSG works like normal group
            this.addField_MFString(ctx, 'invisibleNodes', []);  // allows disabling nodes with given label name (incl. prefix*)
            this.addField_SFBool(ctx, 'internalCulling', false);    // experimental field to enable internal culling algos

            this._idList = [];          // to be updated by socket connection
            this._websocket = null;     // pointer to socket

            this._nameObjMap = {};
            this._createTime = [];
            this._visibleList = [];

            if (ctx)
                this.initializeSocket();    // init socket connection
            else
                x3dom.debug.logWarning("RemoteSelectionGroup: No runtime context found!");
        },
        {
            initializeSocket: function() 
            {
                var that = this;
                
                if ("WebSocket" in window)
                {
                    var wsUrl = "ws://localhost:35668/cstreams/0";
                    
                    if (this._vf.url.length && this._vf.url[0].length)
                        wsUrl = this._vf.url[0];

                    this._websocket = new WebSocket(wsUrl);

                    this._websocket._lastMsg = null;
                    this._websocket._lastData = "";

                    this._websocket.onopen = function(evt)
                    {
                        x3dom.debug.logInfo("WS Connected");
                        
                        var view = that._nameSpace.doc._viewarea.getViewMatrix();
                        this._lastMsg = view.toGL().toString();

                        view = that._nameSpace.doc._viewarea.getProjectionMatrix();
                        this._lastMsg += ("," + view.toGL().toString());

                        this.send(this._lastMsg);
                        x3dom.debug.logInfo("WS Sent: " + this._lastMsg);
                        
                        this._lastMsg = "";     // triggers first update
                        this._lastData = "";
                    };

                    this._websocket.onclose = function(evt) 
                    {
                        x3dom.debug.logInfo("WS Disconnected");

                        if (that._vf.reconnect)
                        {
                            window.setTimeout(function() { 
        						that.initializeSocket();
        					}, 2000);
					    }
                    };

                    this._websocket.onmessage = function(evt) 
                    {
                        if (that._vf.maxRenderedIds < 0)
                        {
                            // render all sent items
                            that._idList = x3dom.fields.MFString.parse(evt.data);
                        }
                        else if (that._vf.maxRenderedIds > 0) 
                        {
                            // render #maxRenderedIds items
                            that._idList = [];
                            var arr = x3dom.fields.MFString.parse(evt.data);
                            var n = Math.min(arr.length, Math.abs(that._vf.maxRenderedIds));

                            for (var i=0; i<n; ++i) {
                                that._idList[i] = arr[i];
                            }
                        }
                        
                        if (that._vf.maxRenderedIds != 0 && this._lastData != evt.data)
                        {
                            this._lastData = evt.data;
                            that._nameSpace.doc.needRender = true;
                            //x3dom.debug.logInfo("WS Response: " + evt.data);
                        }
                    };

                    this._websocket.onerror = function(evt) 
                    {
                        x3dom.debug.logError(evt.data);
                    };

                    this._websocket.updateCamera = function()
                    {
                        // send again
                        var view = that._nameSpace.doc._viewarea.getViewMatrix();
                        var message = view.toGL().toString();

                        view = that._nameSpace.doc._viewarea.getProjectionMatrix();
                        message += ("," + view.toGL().toString());

                        if (this._lastMsg != null && this._lastMsg != message)
                        {
                            this._lastMsg = message;
                            this.send(message);
                            //x3dom.debug.logInfo("WS Sent: " + message);
                        }
                    };

                    // if there were a d'tor this would belong there
                    // this._websocket.close();
                }
                else
                {
                    x3dom.debug.logError("Browser has no WebSocket support!");
                }
            },

            nodeChanged: function ()
            {
                var n = this._vf.label.length;

                this._nameObjMap = {};
                this._createTime = new Array(n);
                this._visibleList = new Array(n);

                for (var i=0; i<n; ++i)
                {
                    var shape = this._childNodes[i];
                    if (shape && x3dom.isa(shape, x3dom.nodeTypes.X3DShapeNode)) {
                        this._nameObjMap[this._vf.label[i]] = { shape: shape, pos: i };
                        this._visibleList[i] = true;
                    }
					else {
						this._visibleList[i] = false;
						x3dom.debug.logError("Invalid children: " + this._vf.label[i]);
					}
					// init list that holds creation time of gl object
					this._createTime[i] = 0;
                }
            },

            fieldChanged: function(fieldName)
            {
                if (fieldName == "url")
                {
                    if (this._websocket) {
                        this._websocket.close();
                        this._websocket = null;
                    }
                    this.initializeSocket();
                }
                else if (fieldName == "invisibleNodes")
                {
                    for (var i=0, n=this._vf.label.length; i<n; ++i)
                    {
                        var shape = this._childNodes[i];
                        
                        if (shape && x3dom.isa(shape, x3dom.nodeTypes.X3DShapeNode)) 
                        {
                            this._visibleList[i] = true;
                            
                            for (var j=0; j<this._vf.invisibleNodes.length; ++j)
                            {
                                var nodeName = this._vf.invisibleNodes[j];
                                var starInd = nodeName.lastIndexOf('*');
                                var matchNameBegin = false;
                                
                                if (starInd > 0) {
                                    nodeName = nodeName.substring(0, starInd);
                                    matchNameBegin = true;
                                }
                                if (nodeName.length <= 1)
                                    continue;
                                
                                if ((matchNameBegin && this._vf.label[i].indexOf(nodeName) == 0) ||
                                    this._vf.label[i] == nodeName) {
                                    this._visibleList[i] = false;
                                    break;
                                }
                            }
                        }
                        else {
                            this._visibleList[i] = false;
                        }
                    }
                }
            },
            
            getNumRenderedObjects: function(len, isMoving)
            {
                var n = len;
				
                if (this._vf.maxRenderedIds > 0)
                {
                    var num = Math.max(this._vf.maxRenderedIds, 16);  // set lower bound
                    
                    var scale = 1;  // scale down on move
                    if (isMoving)
                        scale = Math.min(this._vf.scaleRenderedIdsOnMove, 1);
                    
                    num = Math.max(Math.round(scale * num), 0);
                    n = Math.min(n, num);
                }
                
                return n;
            },

            // Collects array of [matrix, node] for all objects with given id that should be drawn
            // out is drawableObjects array
            collectDrawableObjects: function (transform, out)
            {
                if (!this._vf.render || !out) {
                    return;
                }
                
                var isMoving = this._nameSpace.doc._viewarea.isMoving();
                
                var ts = new Date().getTime();
                var maxLiveTime = 10000;
                var i, n;
                
                if (!this._vf.enableCulling)
                {
                    n = this.getNumRenderedObjects(this._childNodes.length, isMoving);
                    
                    // experimental
                    var view_frustum = null;
                    
                    if (this._vf.internalCulling == true)
                    {
        		        var viewpoint = this._nameSpace.doc._viewarea._scene.getViewpoint();
                        var near = viewpoint.getNear();
                        
                        var proj = this._nameSpace.doc._viewarea.getProjectionMatrix();
                        var view = this._nameSpace.doc._viewarea.getViewMatrix();
                        
                        view_frustum = new x3dom.fields.FrustumVolume(proj.mult(view));
                        
                		var trafo = this.getCurrentTransform();
                		var modelView = view.mult(trafo);
                		
                        var imgPlaneHeightAtDistOne = viewpoint.getImgPlaneHeightAtDistOne();
                        imgPlaneHeightAtDistOne /= this._nameSpace.doc._viewarea._height;
                        
                		var box = new x3dom.fields.BoxVolume();
        		    }
        		    
                    for (i=0, cnt=0; i<this._childNodes.length; i++)
                    {
                        var shape = this._childNodes[i];
                        
                        if (shape)
                        {
                            var needCleanup = true;
                            
                            if (this._visibleList[i] && cnt < n)
                            {
                                if (view_frustum)   // experimental
                                {
                                    shape.getVolume(box.min, box.max, false);
                                    box.transform(trafo);
                                }
                                
                                if (!view_frustum || view_frustum.intersect(box))
                                {
                                    var pxThreshold = 20, numPixel = pxThreshold;
                                    
                                    if (view_frustum)
                                    {
                                        var center = modelView.multMatrixPnt(shape.getCenter());
                            		    var dia = shape.getDiameter();
                            		    
                                        var dist = Math.max(-center.z - dia / 2, near);
                                        var projPixelLength = dist * imgPlaneHeightAtDistOne;
                                        
                                        numPixel = dia / projPixelLength;
                                    }
                                    
                                    // collect drawables
                                    if (numPixel > pxThreshold)
                                    {
                                        shape.collectDrawableObjects(transform, out);
                                        this._createTime[i] = ts;
                                        cnt++;
                                        needCleanup = false;
                                    }
                                }
                            }
                            
                            if (needCleanup && !isMoving && this._createTime[i] > 0 && 
                                ts - this._createTime[i] > maxLiveTime && shape._cleanupGLObjects)
                            {
                                shape._cleanupGLObjects(true);
                                this._createTime[i] = 0;
                            }
                        }
                    }
                    
                    return;
                }

                if (this._websocket)
                    this._websocket.updateCamera();

                if (this._vf.label.length)
                {
                    n = this.getNumRenderedObjects(this._idList.length, isMoving);
                    
                    for (i=0; i<n; i++)
                    {
                        var obj = this._nameObjMap[this._idList[i]];
                        if (obj && obj.shape) {
                            obj.shape.collectDrawableObjects(transform, out);
                            this._createTime[obj.pos] = ts;
                        }
						else
							x3dom.debug.logError("Invalid label: " + this._idList[i]);
                    }
                    
                    for (i=0; i<this._childNodes.length; i++)
                    {
                        if (this._childNodes[i] && !isMoving && this._createTime[i] > 0 && 
                            ts - this._createTime[i] > maxLiveTime && this._childNodes[i]._cleanupGLObjects)
                        {
                            this._childNodes[i]._cleanupGLObjects(true);
                            this._createTime[i] = 0;
                        }
                    }
                }
            }
        }
    )
);

// Not a real X3D node type
// ### Scene ###
x3dom.registerNodeType(
    "Scene",
    "Core",
    defineClass(x3dom.nodeTypes.X3DGroupingNode,
        function (ctx) {
            x3dom.nodeTypes.Scene.superClass.call(this, ctx);

            // define the experimental picking mode: box, idBuf, idBuf24, color, texCoord
            this.addField_SFString(ctx, 'pickMode', "idBuf");
            // experimental field to switch off picking
            this.addField_SFBool(ctx, 'doPickPass', true);
            
            // yet another exp. field for shadow dom remapping
            this.addField_SFString(ctx, 'shadowObjectIdMapping', "");
            
            // very experimental to avoid collect at each frame to update objects + trafos
            // TODO; add onload update handler to make it work with inline nodes
            this.addField_SFBool(ctx, 'isStaticHierarchy', false);
            
            // If TRUE, transparent objects are sorted from back to front
            this.addField_SFBool(ctx, 'sortTrans', true);
            // If TRUE, objects outside the viewing frustum are ignored
            this.addField_SFBool(ctx, 'frustumCulling', true);
            
            this._lastMin = null;
            this._lastMax = null;
            
            this._shadowIdMap = null;
            this.drawableObjects = null;    // webgl helper object
        },
        {
            /* Bindable getter (e.g. getViewpoint) are added automatically */
            
            nodeChanged: function()
            {
                this.loadMapping();
            },
            
            fieldChanged: function(fieldName)
            {
                if (fieldName == "shadowObjectIdMapping")
                    this.loadMapping();
            },
            
            updateVolume: function()
            {
                var min = x3dom.fields.SFVec3f.MAX();
                var max = x3dom.fields.SFVec3f.MIN();
                
                if (this.getVolume(min, max, true)) {
                    this._lastMin = min;
                    this._lastMax = max;
                }
            },
            
            loadMapping: function()
            {
                this._shadowIdMap = null;
                
                if (this._vf.shadowObjectIdMapping.length == 0) {
                    return;
                }
                
                var that = this;
                var xhr = new XMLHttpRequest();
                
                xhr.open("GET", encodeURI(this._nameSpace.getURL(this._vf.shadowObjectIdMapping)), true);
                xhr.send();
                
                xhr.onload = function()
                {
                    that._shadowIdMap = eval("(" + xhr.response + ")");
                };
            }
        }
    )
);
