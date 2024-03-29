import { Chunk } from './chunk.js';
import { EmptyChunk } from './emptyChunk.js';

var World = function (chunkSize_, renderRadius_) {

  var chunkSize = new THREE.Vector3(chunkSize_, chunkSize_, chunkSize_);
  // how many chunks in each direction should be visible?
  var renderRadius = renderRadius_;
  // how far do you have to move from the focused chunk to change focus?
  var chunkRadius = 2;

  // call this function to request a chunk from the server. If this
  // function is null, you are the server.
  var requestChunk = null;

  var focusedChunk = null;

  var chunkMap = {};

  function chunkKey(v) {
    // v must be floored
    return '' + v.x + ';' + v.y + ';' + v.z;
  }

  function vec2chunk(v) {
    let p = v.floor();
    return chunkMap[chunkKey(p)];
  }

  function vec2pos(v) {
    return v.multiply(chunkSize);
  }

  function pos2chunk(p) {
    return vec2chunk(p.clone().divide(chunkSize));
  }

  // map is stored in [y[z[x]]] form, chunks use [z[y[x]]]
  // need to swap y and z
  // xyz variables below refer to the new map
  function flipMap(map) {
    var newMap = [];
    for (let z = 0; z < map[0].length; z++) {
      newMap.push([]);
      for (let y = 0; y < map.length; y++) {
        newMap[z].push([])
        newMap[z][y] = map[y][z];
      }
    }
    return newMap;
  }

  this.setChunk = function (chunk) {
    chunk.world = this;
    chunkMap[chunkKey(chunk.getPosition().divide(chunkSize))] = chunk;
  }

  this.blockAt = function (p) {
    let chunk = pos2chunk(p);
    if (!chunk) {
      return false;
    }
    return chunk.blockAt(p.clone().sub(chunk.getPosition()));
  }

  this.setBlock = function(p, block) {
    let chunk = pos2chunk(p);
    if (chunk) {
      // can only set blocks in chunks that are already there
      // can't build outside of existing chunks - TODO fix this
      chunk.setBlock(p.clone().sub(chunk.getPosition()), block);
    }
  }

  this.chunkAt = function (p) {
    return pos2chunk(p);
  }

  this.noBlockAt = function (p) {
    return !this.blockAt(p);
  }

  this.adjacentChunks = function (position) {
    let p = position.clone().divide(chunkSize).floor();
    let x = p.x;
    let y = p.y;
    let z = p.z;
    let neighbors = [];

    for (let ix = -1; ix < 2; ix++) {
      for (let iy = -1; iy < 2; iy++) {
        for (let iz = -1; iz < 2; iz++) {
          let chunk = vec2chunk(p.set(x + ix, y + iy, z + iz));
          neighbors.push(chunk);
        }
      }
    }
    return neighbors;
  }

  this.setRequestChunkFunc = function(req) {
    requestChunk = req;
  }

  var visibleChunkCacheCenter = null;
  var visibleChunkCache = [];

  this.visibleChunks = function () {
    if (visibleChunkCacheCenter === focusedChunk) {
      return visibleChunkCache;
    }

    let center = focusedChunk.getPosition().divide(chunkSize).floor();
    let p = center.clone();
    let x = p.x;
    let y = p.y;
    let z = p.z;
    let visible = [];

    let outerBound = Math.floor(renderRadius) + 1;

    for (let ix = -outerBound; ix <= outerBound; ix++) {
      for (let iy = -outerBound; iy <= outerBound; iy++) {
        for (let iz = -outerBound; iz <= outerBound; iz++) {
          if (p.set(x + ix, y + iy, z + iz).distanceTo(center) <= renderRadius) {
            let chunk = vec2chunk(p);
            if (!chunk && requestChunk) {
              chunk = this.createEmptyChunkAt(vec2pos(p));
              requestChunk(chunk.getPosition());
            }
            visible.push(chunk);
          }
        }
      }
    }

    visibleChunkCache = visible.filter(x => x != null);
    return visibleChunkCache;
  }

  this.createEmptyChunkAt = function (position) {
    let chunk = new EmptyChunk(position.clone().divide(chunkSize).floor().multiply(chunkSize), chunkSize.clone());
    this.setChunk(chunk);
    return chunk;
  }

  this.calculateFocusedChunk = function (player) {
    let p = player.getPosition();
    let playerChunk = pos2chunk(p);
    if(!playerChunk && requestChunk){
      playerChunk = this.createEmptyChunkAt(p);
      requestChunk(p);
    }

    if (playerChunk === focusedChunk) return;
    if (!focusedChunk || focusedChunk.distanceTo(p) > chunkRadius) {
      focusedChunk = playerChunk;
    }
  }

  this.updateVisibleChunks = function (scene) {
    let previouslyVisible = [...visibleChunkCache]; // clone
    let visible = this.visibleChunks()
    let difference = previouslyVisible.filter(x => !visible.includes(x));

    difference.forEach(function (chunk) {
      chunk.hide(scene); // keep graphics object in memory
      // unfollow ?
    });
    visible.forEach(function (chunk) {
      chunk.draw(scene);
    });
  }

  this.getRandomChunk = function() {
    let keylist = Object.keys(chunkMap);
    return chunkMap[keylist[Math.floor(Math.random()*keylist.length)]];
  }

  this.draw = function (scene, player) {
    this.calculateFocusedChunk(player);
    if (!focusedChunk) return;
    this.updateVisibleChunks(scene);
  }

  this.print = function () {
    Object.keys(chunkMap).forEach(function (key) {
      console.log(key);
    });
  }

  // Read a blockball map file and create chunks based on the chunksize
  // TODO: validate input
  this.populateWorldFromMap = function (mapContents) {
    this.fullRefresh();
    
    var oldMap = mapContents["map"]
    var map = flipMap(oldMap)

    var mapLenZ = map.length
    var mapLenY = map[0].length
    var mapLenX = map[0][0].length

    var chunkSizeInt = chunkSize.x

    for (let z = 0; z < mapLenZ + chunkSizeInt; z += chunkSizeInt) {
      for (let y = 0; y < mapLenY + chunkSizeInt; y += chunkSizeInt) {
        for (let x = 0; x < mapLenX + chunkSizeInt; x += chunkSizeInt) {
          var chunkBlocks = []
          for (let cz = 0; cz < chunkSizeInt; cz++) {
            chunkBlocks.push([])
            for (let cy = 0; cy < chunkSizeInt; cy++) {
              // Fill in zeros if out of range of map
              if (z + cz >= mapLenZ) {
                chunkBlocks[cz].push(Array.from({ length: chunkSizeInt }, (v, i) => 0))
              } else if (y + cy >= mapLenY) {
                chunkBlocks[cz].push(Array.from({ length: chunkSizeInt }, (v, i) => 0))
              } else if (x + chunkSizeInt >= mapLenX) {
                var mapArr = map[z + cz][y + cy].slice(x)
                var emptyArr = Array.from({ length: chunkSizeInt - mapArr.length }, (v, i) => 0)
                chunkBlocks[cz].push(mapArr.concat(emptyArr))
              } else {
                chunkBlocks[cz].push(map[z + cz][y + cy].slice(x, x + chunkSizeInt))
              }
            }
          }
          var chunk = new Chunk(new THREE.Vector3(z, y, x), chunkBlocks, mapContents.colors);
          this.setChunk(chunk);
        }
      }
    }
  }

  this.fullRefresh = function (scene = false) {
    // if the world is being rendered (client side)
    if(scene){
      // un-render and remove from scene all chunk meshes
      Object.keys(chunkMap).forEach(function(chunkKey){
        chunkMap[chunkKey].unbuild(scene);
      });
    }
    chunkMap = {};
    visibleChunkCache = [];
    visibleChunkCacheCenter = null;
  }
};

World.prototype.constructor = World;

export { World };
