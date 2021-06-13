const config = require('./config.json')
const path = require('path')
const fs = require('fs')

const root = path.join(__dirname, '..')

for (const file of config.files) {
  try {
    const code = fs.readFileSync(path.join(root, file), 'utf8')
    const newCode = commentFile(code, file)
    fs.writeFileSync(path.join(root, file), newCode)
  } catch (e) {
    console.error(e)
  }
}

function commentFile (file, fileName) {
  let numOfComments = 0
  let lines = file.split('\n')
  let newCode = lines
  const toComment = Object.entries(config.config).filter(o => o[1]).map(o => o[0])
  for (const s of toComment) {
    lines = Array.from(newCode)
    newCode = []
    const regex = new RegExp(`^\\s*${s}`)
    for (const line of lines) {
      if (line.match(regex)) {
        newCode.push(line.replace(s, '// ' + s))
        numOfComments += 1
      } else {
        newCode.push(line)
      }
    }
  }
  if (numOfComments) console.info('Commented', numOfComments, 'lines in', fileName)
  return newCode.join('\n')
}
