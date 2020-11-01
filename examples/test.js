const mineflayer = require('mineflayer')
const { goals, inject, Movements } = require('mineflayer-pathfinder')

if (process.argv.length > 6) {
  console.log('Usage : node test.js [<host>] [<port>] [<name>] [<password>]')
  process.exit(1)
}

const bot = mineflayer.createBot({
  host: process.argv[2] || 'localhost',
  port: parseInt(process.argv[3]) || 25565,
  username: process.argv[4] || 'pathfinder',
  password: process.argv[5]
})

bot.loadPlugin(inject)

bot.once('spawn', () => {
  // Once we've spawn, it is safe to access mcData because we know the version
  const mcData = require('minecraft-data')(bot.version)

  // We create different movement generators for different type of activity
  const defaultMove = new Movements(bot, mcData)

  bot.on('path_update', r => {
    const nodesPerTick = ((r.visitedNodes * 50) / r.time).toFixed(2)
    console.log(
      `I can get there in ${
        r.path.length
      } moves. Computation took ${r.time.toFixed(
        2
      )} ms (${nodesPerTick} nodes/tick).`
    )
  })

  bot.on('goal_reached', () => {
    console.log('Here I am !')
  })

  bot.on('chat', (username, message) => {
    if (username === bot.username) return

    const target = bot.players[username] ? bot.players[username].entity : null
    if (message === 'come') {
      if (!target) {
        bot.chat("I don't see you !")
        return
      }
      const p = target.position

      bot.pathfinder.setMovements(defaultMove)
      bot.pathfinder.setGoal(new goals.GoalNear(p.x, p.y, p.z, 1))
    } else if (message.startsWith('goto')) {
      const cmd = message.split(' ')

      if (cmd.length === 4) {
        // goto x y z
        const x = parseInt(cmd[1], 10)
        const y = parseInt(cmd[2], 10)
        const z = parseInt(cmd[3], 10)

        bot.pathfinder.setMovements(defaultMove)
        bot.pathfinder.setGoal(new goals.GoalBlock(x, y, z))
      } else if (cmd.length === 3) {
        // goto x z
        const x = parseInt(cmd[1], 10)
        const z = parseInt(cmd[2], 10)

        bot.pathfinder.setMovements(defaultMove)
        bot.pathfinder.setGoal(new goals.GoalXZ(x, z))
      } else if (cmd.length === 2) {
        // goto y
        const y = parseInt(cmd[1], 10)

        bot.pathfinder.setMovements(defaultMove)
        bot.pathfinder.setGoal(new goals.GoalY(y))
      }
    } else if (message === 'follow') {
      bot.pathfinder.setMovements(defaultMove)
      bot.pathfinder.setGoal(new goals.GoalFollow(target, 3), true)
      // follow is a dynamic goal: setGoal(goal, dynamic=true)
      // when reached, the goal will stay active and will not
      // emit an event
    } else if (message === 'avoid') {
      bot.pathfinder.setMovements(defaultMove)
      bot.pathfinder.setGoal(
        new goals.GoalInvert(new goals.GoalFollow(target, 5)),
        true
      )
    } else if (message === 'stop') {
      bot.pathfinder.setGoal(null)
    }
  })
})
