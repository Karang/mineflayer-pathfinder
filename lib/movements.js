const { Vec3 } = require('vec3')
const nbt = require('prismarine-nbt')
const Move = require('./move')

const cardinalDirections = [
  { x: -1, z: 0 }, // north
  { x: 1, z: 0 }, // south
  { x: 0, z: -1 }, // west
  { x: 0, z: 1 } // east
]
const diagonalDirections = [
  { x: -1, z: -1 },
  { x: -1, z: 1 },
  { x: 1, z: -1 },
  { x: 1, z: 1 }
]

class Movements {
  constructor (bot, mcData) {
    this.bot = bot

    this.canDig = true
    this.allowEntityDetection = true  // Test for entities that may obstruct path or prevent block placement
    this.digCost = 1
    this.placeCost = 1
    this.liquidCost = 1
	this.entityCost = 1 // Extra cost for moving through an entity hitbox (besides items). Intended to help for avoiding hostiles when cornered, normally the bot will try to walk straight through them
	// TODO: Maybe add a seperate modifier for hostiles or an 'entitiesToAvoid' list?

    this.dontCreateFlow = true
    this.allow1by1towers = true
    this.allowFreeMotion = false
    this.allowParkour = true
    this.allowSprinting = true

    this.blocksCantBreak = new Set()
    this.blocksCantBreak.add(mcData.blocksByName.chest.id)
    this.blocksCantBreak.add(mcData.blocksByName.wheat.id)

    mcData.blocksArray.forEach(block => {
      if (block.diggable) return
      this.blocksCantBreak.add(block.id)
    })

    this.blocksToAvoid = new Set()
    this.blocksToAvoid.add(mcData.blocksByName.fire.id)
    this.blocksToAvoid.add(mcData.blocksByName.wheat.id)
    this.blocksToAvoid.add(mcData.blocksByName.lava.id)

    this.liquids = new Set()
    this.liquids.add(mcData.blocksByName.water.id)
    this.liquids.add(mcData.blocksByName.lava.id)

    this.climbables = new Set()
    this.climbables.add(mcData.blocksByName.ladder.id)
    // this.climbables.add(mcData.blocksByName.vine.id)

    this.replaceables = new Set()
    this.replaceables.add(mcData.blocksByName.air.id)
    if (mcData.blocksByName.cave_air) this.replaceables.add(mcData.blocksByName.cave_air.id)
    if (mcData.blocksByName.void_air) this.replaceables.add(mcData.blocksByName.void_air.id)
    this.replaceables.add(mcData.blocksByName.water.id)
    this.replaceables.add(mcData.blocksByName.lava.id)

    this.scafoldingBlocks = []
    this.scafoldingBlocks.push(mcData.blocksByName.dirt.id)
    this.scafoldingBlocks.push(mcData.blocksByName.cobblestone.id)

    const Block = require('prismarine-block')(bot.version)
    this.fences = new Set()
    this.carpets = new Set()
    mcData.blocksArray.map(x => Block.fromStateId(x.minStateId, 0)).forEach(block => {
      if (block.shapes.length > 0) {
        // Fences or any block taller than 1, they will be considered as non-physical to avoid
        // trying to walk on them
        if (block.shapes[0][4] > 1) this.fences.add(block.type)
        // Carpets or any blocks smaller than 0.1, they will be considered as safe to walk in
        if (block.shapes[0][4] < 0.1) this.carpets.add(block.type)
      }
    })

    this.maxDropDown = 4
  }

  countScaffoldingItems () {
    let count = 0
    const items = this.bot.inventory.items()
    for (const id of this.scafoldingBlocks) {
      for (const j in items) {
        const item = items[j]
        if (item.type === id) count += item.count
      }
    }
    return count
  }

  getScaffoldingItem () {
    const items = this.bot.inventory.items()
    for (const id of this.scafoldingBlocks) {
      for (const j in items) {
        const item = items[j]
        if (item.type === id) return item
      }
    }
    return null
  }
  
  // Get any entities who's bounding box intersects the node + offset
  // Could work impropperly if the entity happens to walk exactly along the path and gets detected again but, this probably won't happen. Maybe in the future there could be a sorted list of ents to select from and also a list of detected ents
  getIntersectingEntities (pos, dx, dy, dz) {
	let ents = []
	if (this.allowEntityDetection && pos) {
	  const MAX_DIST_SQ = 36  // Needs to be this high b/c we pretend the floored coords of the block are a 2x2 space, then we take into account the max 'typical' bounding box size of 4x4
	  const dPos = new Vec3(pos.x + dx, pos.y + dy, pos.z + dz).floored()
      for (const ent of Object.values(this.bot.entities)) {
		if (ent !== this.bot.entity && ent.type != 'item') {
		  const entPos = ent.position.offset(ent.velocity.x, ent.onGround * ent.velocity.y, ent.velocity.z)
		  if (entPos.distanceSquared(dPos) <= MAX_DIST_SQ) {
		    const maxYCoord = entPos.y + ent.height
		    if ((entPos.y <= dPos.y && maxYCoord > dPos.y) || (entPos.y >= dPos.y && entPos.y < dPos.y + 1.0)) { // Check if ent position below block but bounding box extends into block or the entity's feet are in the block
		      const halfWidth = ent.width/2.0
		      const entBoundsPos = entPos.plus(new Vec3(halfWidth, 0, halfWidth))
		      const entBoundsNeg = entPos.minus(new Vec3(halfWidth, 0, halfWidth))
		      if (((entPos.x >= dPos.x && entPos.x < dPos.x + 1.0) && (entPos.z >= dPos.z && entPos.z < dPos.z + 1.0)) || (((entBoundsPos.x >= dPos.x && entBoundsPos.x < dPos.x + 1.0) || (entBoundsNeg.x >= dPos.x && entBoundsNeg.x < dPos.x + 1.0)) && ((entBoundsPos.z >= dPos.z && entBoundsPos.z < dPos.z + 1.0) || (entBoundsNeg.z >= dPos.z && entBoundsNeg.z < dPos.z + 1.0)))) {
		        ents.push(ent)
		      }
		    }
		  }
	    }
	  }
	}
	return ents
  }
  
  // Faster but doesn't work good for block placement checks. Better for the entity cost system where we want to see if the actual entity is there
  getEntitiesAt (pos, dx, dy, dz) {
	let ents = []
	if (this.allowEntityDetection && pos) {
	  const dPos = new Vec3(pos.x + dx, pos.y + dy, pos.z + dz).floored()
	  for (const ent of Object.values(this.bot.entities)) {
		const entPos = ent.position.offset(ent.velocity.x, ent.onGround * ent.velocity.y, ent.velocity.z)
	    if (ent !== this.bot.entity && ent.type != 'item' && entPos.floored().equals(dPos)) {  
	      ents.push(ent)
	    }
	  }
	}
	return ents
  }

  getBlock (pos, dx, dy, dz) {
    const b = pos ? this.bot.blockAt(new Vec3(pos.x + dx, pos.y + dy, pos.z + dz), false) : null
    if (!b) {
      return {
        replaceable: false,
        safe: false,
        physical: false,
        liquid: false,
        climbable: false,
        height: dy
      }
    }
    b.climbable = this.climbables.has(b.type)
    b.safe = (b.boundingBox === 'empty' || b.climbable || this.carpets.has(b.type)) && !this.blocksToAvoid.has(b.type)
    b.physical = b.boundingBox === 'block' && !this.fences.has(b.type)
    b.replaceable = this.replaceables.has(b.type) && !b.physical
    b.liquid = this.liquids.has(b.type)
    b.height = pos.y + dy
    for (const shape of b.shapes) {
      b.height = Math.max(b.height, pos.y + dy + shape[4])
    }
    return b
  }

  safeToBreak (block) {
    if (!this.canDig) {
      return false
    }

    if (this.dontCreateFlow) {
      // false if next to liquid
      if (this.getBlock(block.position, 0, 1, 0).liquid) return false
      if (this.getBlock(block.position, -1, 0, 0).liquid) return false
      if (this.getBlock(block.position, 1, 0, 0).liquid) return false
      if (this.getBlock(block.position, 0, 0, -1).liquid) return false
      if (this.getBlock(block.position, 0, 0, 1).liquid) return false
    }
    return block.type && !this.blocksCantBreak.has(block.type)
    // TODO: break exclusion areas
  }

  safeOrBreak (block, toBreak) {
    if (block.safe) return 0
    if (!this.safeToBreak(block)) return 100 // Can't break, so can't move
    toBreak.push(block.position)
	
	let cost = 0
	if(block.physical && this.getEntitiesAt(block.position, 0, 1, 0).length) cost += this.entityCost // Add entity cost if there is an entity above (a breakable block) that will fall

    const tool = this.bot.pathfinder.bestHarvestTool(block)
    const enchants = (tool && tool.nbt) ? nbt.simplify(tool.nbt).Enchantments : []
    const effects = this.bot.entity.effects
    const digTime = block.digTime(tool ? tool.type : null, false, false, false, enchants, effects)
	cost += (1 + 3 * digTime / 1000) * this.digCost
    return cost
  }

  // Move where bot jumps up to another block to the side
  getMoveJumpUp (node, dir, neighbors) {
    const blockA = this.getBlock(node, 0, 2, 0)          // During the move we will pass through blocks A, H and B so we need to make sure there is clearance
    const blockH = this.getBlock(node, dir.x, 2, dir.z)
    const blockB = this.getBlock(node, dir.x, 1, dir.z)  // Same height as head before move, this is where our feet will be after the move
    const blockC = this.getBlock(node, dir.x, 0, dir.z)  // Same height as feet before move, we will check whether we can break and place then jump ontop of this

    let cost = 2 // move cost (move+jump)
    const toBreak = []
    const toPlace = []

	if (blockA.physical && this.getIntersectingEntities(blockA.position, 0, 1, 0).length) return // Blocks A, B and H are above C, D and the player's space, we need to make sure there are no entities that will fall down onto our building space if we break them
	if (blockH.physical && this.getIntersectingEntities(blockH.position, 0, 1, 0).length) return
	if (blockB.physical && !blockH.physical && !blockC.physical && this.getIntersectingEntities(blockB.position, 0, 1, 0).length) return // It is fine if an ent falls on B so long as we don't need to replace block C

    if (!blockC.physical) { // Skip this if the jumping block is already solid, we can just check if there is enough clearance to jump there
      if (node.remainingBlocks === 0) return // not enough blocks to place

	  if (this.getIntersectingEntities(blockC.position, 0, 0, 0).length) return // Check for any entities in the way of a block placement

      const blockD = this.getBlock(node, dir.x, -1, dir.z)
      if (!blockD.physical) {  // Check if block below the jumping block is solid, otherwise see if we can place a block that we can walk on
        if (node.remainingBlocks === 1) return // not enough blocks to place (we have to replace block C too)
		
		if (this.getIntersectingEntities(blockD.position, 0, 0, 0).length) return // Check for any entities in the way of a block placement

        if (!blockD.replaceable) {
          if (!this.safeToBreak(blockD)) return
          toBreak.push(blockD.position)
        }
		
		toPlace.push({ x: node.x, y: node.y - 1, z: node.z, dx: dir.x, dy: 0, dz: dir.z, returnPos: new Vec3(node.x, node.y, node.z) })
		cost += this.placeCost // additional cost for placing a block
      }

      if (!blockC.replaceable) {
        if (!this.safeToBreak(blockC)) return
        toBreak.push(blockC.position)
      }

      toPlace.push({ x: node.x + dir.x, y: node.y - 1, z: node.z + dir.z, dx: 0, dy: 1, dz: 0 })
      cost += this.placeCost // additional cost for placing a block
      blockC.height += 1  // Pretend the block height is higher for the algorithm, we will place scaffolding material there later
    }

    const block0 = this.getBlock(node, 0, -1, 0)  // Block directly below feet
    if (blockC.height - block0.height > 1.2) return // Too high to jump

    cost += this.safeOrBreak(blockA, toBreak)
    if (cost > 100) return
    cost += this.safeOrBreak(blockH, toBreak)
    if (cost > 100) return
    cost += this.safeOrBreak(blockB, toBreak)
    if (cost > 100) return
	
    if (!blockB.physical && blockC.physical && this.getEntitiesAt(blockB.position, 0, 0, 0).length) cost += this.entityCost // add cost for entity in B
	
    neighbors.push(new Move(blockB.position.x, blockB.position.y, blockB.position.z, node.remainingBlocks - toPlace.length, cost, toBreak, toPlace))
  }

  getMoveForward (node, dir, neighbors) {
    const blockB = this.getBlock(node, dir.x, 1, dir.z)
    const blockC = this.getBlock(node, dir.x, 0, dir.z)
    const blockD = this.getBlock(node, dir.x, -1, dir.z)

    let cost = 1 // move cost
    const toBreak = []
    const toPlace = []

    if (!blockD.physical && !blockC.liquid) {
      if (node.remainingBlocks === 0) return // not enough blocks to place
      if (this.getIntersectingEntities(blockD.position, 0, 0, 0).length) return // D intersects an entity hitbox

      if (!blockD.replaceable) {
        if (!this.safeToBreak(blockD)) return
        toBreak.push(blockD.position)
      }
      toPlace.push({ x: node.x, y: node.y - 1, z: node.z, dx: dir.x, dy: 0, dz: dir.z })
      cost += this.placeCost // additional cost for placing a block
    }

    cost += this.safeOrBreak(blockB, toBreak)
    if (cost > 100) return
    cost += this.safeOrBreak(blockC, toBreak)
    if (cost > 100) return
	
    if (!blockC.physical && blockD.physical && this.getEntitiesAt(blockC.position, 0, 0, 0).length) cost += this.entityCost // add cost for entity in C
    if (this.getBlock(node, 0, 0, 0).liquid) cost += this.liquidCost

    neighbors.push(new Move(blockC.position.x, blockC.position.y, blockC.position.z, node.remainingBlocks - toPlace.length, cost, toBreak, toPlace))
  }

  getMoveDiagonal (node, dir, neighbors) {
    let cost = Math.SQRT2 // move cost
    const toBreak = []

    const blockC = this.getBlock(node, dir.x, 0, dir.z)
    const y = blockC.physical ? 1 : 0

	// check blocks adjacent and behind (in dir) ending node
    let cost1 = 0
    const toBreak1 = []
    const blockB1 = this.getBlock(node, 0, y + 1, dir.z)
    const blockC1 = this.getBlock(node, 0, y, dir.z)
    cost1 += this.safeOrBreak(blockB1, toBreak1)
    cost1 += this.safeOrBreak(blockC1, toBreak1)

    let cost2 = 0
    const toBreak2 = []
    const blockB2 = this.getBlock(node, dir.x, y + 1, 0)
    const blockC2 = this.getBlock(node, dir.x, y, 0)
    cost2 += this.safeOrBreak(blockB2, toBreak2)
    cost2 += this.safeOrBreak(blockC2, toBreak2)

    if (cost1 < cost2) {
      cost += cost1
      toBreak.push(...toBreak1)
    } else {
      cost += cost2
      toBreak.push(...toBreak2)
    }
    if (cost > 100) return

    cost += this.safeOrBreak(this.getBlock(node, dir.x, y, dir.z), toBreak)
    if (cost > 100) return
    cost += this.safeOrBreak(this.getBlock(node, dir.x, y + 1, dir.z), toBreak)
    if (cost > 100) return
    cost += 1

    if (this.getBlock(node, 0, 0, 0).liquid) cost += this.liquidCost

    const blockD = this.getBlock(node, dir.x, -1, dir.z)
    if (y === 1) {
      const block0 = this.getBlock(node, 0, -1, 0)
      if (blockC.height - block0.height > 1.2) return // Too high to jump
      cost += this.safeOrBreak(this.getBlock(node, 0, 2, 0), toBreak)
      if (cost > 100) return
      neighbors.push(new Move(blockC.position.x, blockC.position.y + 1, blockC.position.z, node.remainingBlocks, cost, toBreak))
    } else if (blockD.physical || blockC.liquid) {
      if (this.getEntitiesAt(blockC.position, 0, 0, 0).length) cost += this.entityCost
      neighbors.push(new Move(blockC.position.x, blockC.position.y, blockC.position.z, node.remainingBlocks, cost, toBreak))
    } else if (this.getBlock(node, dir.x, -2, dir.z).physical || blockD.liquid) {
      if (blockC.liquid) return // dont go underwater
      if (this.getEntitiesAt(blockC.position, 0, -1, 0).length) cost += this.entityCost
      neighbors.push(new Move(blockC.position.x, blockC.position.y - 1, blockC.position.z, node.remainingBlocks, cost, toBreak))
    }
  }

  getLandingBlock (node, dir) {
    let blockLand = this.getBlock(node, dir.x, -2, dir.z)
    while (blockLand.position && blockLand.position.y > 0) {
      if (blockLand.liquid && blockLand.safe) return blockLand
      if (blockLand.physical) {
        if (node.y - blockLand.position.y <= this.maxDropDown) return this.getBlock(blockLand.position, 0, 1, 0)
        return null
      }
      if (!blockLand.safe) return null
      blockLand = this.getBlock(blockLand.position, 0, -1, 0)
    }
    return null
  }

  getMoveDropDown (node, dir, neighbors) {
    const blockB = this.getBlock(node, dir.x, 1, dir.z)
    const blockC = this.getBlock(node, dir.x, 0, dir.z)
    const blockD = this.getBlock(node, dir.x, -1, dir.z)

    let cost = 1 // move cost
    const toBreak = []
    const toPlace = []

    const blockLand = this.getLandingBlock(node, dir)
    if (!blockLand) return

    cost += this.safeOrBreak(blockB, toBreak)
    if (cost > 100) return
    cost += this.safeOrBreak(blockC, toBreak)
    if (cost > 100) return
    cost += this.safeOrBreak(blockD, toBreak)
    if (cost > 100) return

    if (blockC.liquid) return // dont go underwater
	
	if (this.getEntitiesAt(blockLand.position, 0, 0, 0).length) cost += this.entityCost // add cost for entities

    neighbors.push(new Move(blockLand.position.x, blockLand.position.y, blockLand.position.z, node.remainingBlocks - toPlace.length, cost, toBreak, toPlace))
  }

  getMoveDown (node, neighbors) {
    const block0 = this.getBlock(node, 0, -1, 0)

    let cost = 1 // move cost
    const toBreak = []
    const toPlace = []

    const blockLand = this.getLandingBlock(node, { x: 0, z: 0 })
    if (!blockLand) return

    cost += this.safeOrBreak(block0, toBreak)
    if (cost > 100) return
	
	if (this.getBlock(node, 0, 0, 0).liquid) return // dont go underwater
	if (this.getEntitiesAt(blockLand.position, 0, 0, 0).length) cost += this.entityCost // add cost for entities

    neighbors.push(new Move(blockLand.position.x, blockLand.position.y, blockLand.position.z, node.remainingBlocks - toPlace.length, cost, toBreak, toPlace))
  }

  // Move where bot does a 1x1 block stacking jump
  getMoveUp (node, neighbors) {
    const block1 = this.getBlock(node, 0, 0, 0)
    if (block1.liquid) return
	  if (this.getIntersectingEntities(node, 0, 0, 0).length) return // an entity (besides the player) is blocking the building area

    const block2 = this.getBlock(node, 0, 2, 0) // head clearance for when the player jumps up
	  if (block2.physical && this.getIntersectingEntities(node, 0, 3, 0).length) return // an entity will fall into the building area
    let cost = 1 // move cost
    const toBreak = []
    const toPlace = []
    cost += this.safeOrBreak(block2, toBreak)
    if (cost > 100) return

    if (!block1.climbable) {
      if (!this.allow1by1towers || node.remainingBlocks === 0) return // not enough blocks to place

      if (!block1.replaceable) {
        if (!this.safeToBreak(block1)) return
        toBreak.push(block1.position)
      }

      const block0 = this.getBlock(node, 0, -1, 0)
      if (block0.physical && block0.height - node.y < -0.2) return // cannot jump-place from a half block

      toPlace.push({ x: node.x, y: node.y - 1, z: node.z, dx: 0, dy: 1, dz: 0, jump: true })
      cost += this.placeCost // additional cost for placing a block
    }

    neighbors.push(new Move(node.x, node.y + 1, node.z, node.remainingBlocks - toPlace.length, cost, toBreak, toPlace))
  }
  
  // Jump up, down or forward over a 1 to 3 block gap
  getMoveParkourForward (node, dir, neighbors) {
    const block0 = this.getBlock(node, 0, -1, 0)
    const block1 = this.getBlock(node, dir.x, -1, dir.z)  // Check if floor block directly infront is taller, then if the blocks directly infront are safe to walk through
    if ((block1.physical && block1.height >= block0.height) ||
      !this.getBlock(node, dir.x, 0, dir.z).safe ||
      !this.getBlock(node, dir.x, 1, dir.z).safe) return
	  
	  let cost = 1 // Mostly used for checking if entities are in the jump path. Will be useful incase we want to prefer a path with no potential hostiles that can knock us out of our jump
	               // Leaving entities at the ceiling level (along path) out for now because there are few cases where that will be important
	
	  cost += (this.getIntersectingEntities(node, dir.x, 0, dir.z).length !== 0) * this.entityCost  // more accurate than getEntitiesAt, better here for reasons above

    // If we have a block on the ceiling, we cannot jump but we can still fall
    let ceilingClear = this.getBlock(node, 0, 2, 0).safe && this.getBlock(node, dir.x, 2, dir.z).safe

    // Similarly for the down path
    let floorCleared = this.getBlock(node, dir.x, -2, dir.z).safe

    const maxD = this.allowSprinting ? 4 : 2

    for (let d = 2; d <= maxD; d++) {
      const dx = dir.x * d
      const dz = dir.z * d
      const blockA = this.getBlock(node, dx, 2, dz)
      const blockB = this.getBlock(node, dx, 1, dz)
      const blockC = this.getBlock(node, dx, 0, dz)
      const blockD = this.getBlock(node, dx, -1, dz)
	  
	    if(blockC.safe && this.getIntersectingEntities(blockC.position, 0, 0, 0).length !== 0) cost += this.entityCost
	  
      if (ceilingClear && blockB.safe && blockC.safe && blockD.physical) {
        // Forward
        neighbors.push(new Move(blockC.position.x, blockC.position.y, blockC.position.z, node.remainingBlocks, cost, [], [], true))
        break
      } else if (ceilingClear && blockB.safe && blockC.physical) {
        // Up
        if (blockA.safe) {
          if (blockC.height - block0.height > 1.2) break // Too high to jump
		  cost += (this.getIntersectingEntities(blockB.position, 0, 0, 0).length !== 0) * this.entityCost
          neighbors.push(new Move(blockB.position.x, blockB.position.y, blockB.position.z, node.remainingBlocks, cost, [], [], true))
          break
        }
      } else if ((ceilingClear || d === 2) && blockB.safe && blockC.safe && blockD.safe && floorCleared) {
        // Down
        const blockE = this.getBlock(node, dx, -2, dz)
        if (blockE.physical) {
		  cost += (this.getIntersectingEntities(blockD.position, 0, 0, 0).length !== 0) * this.entityCost
          neighbors.push(new Move(blockD.position.x, blockD.position.y, blockD.position.z, node.remainingBlocks, cost, [], [], true))
        }
        floorCleared = floorCleared && blockE.safe
      } else if (!blockB.safe || !blockC.safe) {
        break
      }
      ceilingClear = ceilingClear && blockA.safe
    }
  }

  // for each cardinal direction:
  // "." is head. "+" is feet and current location.
  // "#" is initial floor which is always solid. "a"-"u" are blocks to check
  //
  //   --0123-- horizontalOffset
  //  |
  // +2  aho
  // +1  .bip
  //  0  +cjq
  // -1  #dkr
  // -2   els
  // -3   fmt
  // -4   gn
  //  |
  //  dy

  getNeighbors (node) {
    const neighbors = []

    // Simple moves in 4 cardinal points
    for (const i in cardinalDirections) {
      const dir = cardinalDirections[i]
      this.getMoveForward(node, dir, neighbors)
      this.getMoveJumpUp(node, dir, neighbors)
      this.getMoveDropDown(node, dir, neighbors)
      if (this.allowParkour) {
        this.getMoveParkourForward(node, dir, neighbors)
      }
    }

    // Diagonals
    for (const i in diagonalDirections) {
      const dir = diagonalDirections[i]
      this.getMoveDiagonal(node, dir, neighbors)
    }

    this.getMoveDown(node, neighbors)
    this.getMoveUp(node, neighbors)

    return neighbors
  }
}

module.exports = Movements
