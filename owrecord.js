const util = require('util')
const fs = require('fs')
const ini = require('ini')
const Client = require('owfs').Client
const chalk = require('chalk')
const database = require('./database')
const log = console.log

const error = chalk.red
const info = chalk.yellow

class OwRecorder {
  #settings = {}
  #db
  #readingsObj = {}
  constructor (settingsPath) {
    try {
      this.#settings = ini.parse(fs.readFileSync(settingsPath, 'utf-8'))
    } catch (problem) {
      log(error('Failed to read settings.ini. Make sure it\'s in the same location as this script file.'))
      process.kill(process.pid, 'SIGTERM')
    }
    this.#db = database(this.#settings)
  }

  async validateDbConnection () {
    const check = await this.#db.connect()
    check.done()
    return check.client.serverVersion
  }

  #formatSaveReadings (readingsArray, sensorsArray) {
    for (const [index, reading] of readingsArray.entries()) {
      if (reading.status === 'fulfilled') {
        let value = +(reading.value)

        if (sensorsArray[index][0].endsWith('_humidity')) {
          value = Math.round(value)
        } else { // presumed _temperature
          value = +value.toFixed(2)
        }
        this.#readingsObj[sensorsArray[index][0]] = value
      } else if (reading.status === 'rejected') {
        const now = new Date()
        log(info(`At ${now.toISOString()} reading the following onewire sensor failed: ${sensorsArray[index][1]}`))
        log(info(reading.reason + '\n')) // not critical if not all..then we shall at least receive a timestamp indicating an attempt was made
      }
    }
  }

  async readOwParallell () {
    const owserverObj = this.#settings.owserver
    const sensorsArray = Object.entries(this.#settings.owsensors)
    const owConnection = new Client(owserverObj.Host, +owserverObj.Port)
    const owRead = util.promisify(owConnection.read.bind(owConnection))

    const readingsArray = await Promise.allSettled(sensorsArray.map(sensor => owRead(sensor[1])))
    this.#formatSaveReadings(readingsArray, sensorsArray)

    const now = new Date()
    if (Object.keys(this.#readingsObj).length === 0) {
      log(info(`At ${now.toISOString()} all sensor readings failed.\n`))
    }

    this.#readingsObj.timestamp = now
    return this.#readingsObj // could be useful for debugging the onewire sensors connection or writing to a file instead of db
  }

  async insertIntoDb () {
    try {
      await this.#db.none('INSERT INTO ' + this.#settings.postgresql.Table + '($<this:name>) VALUES($<this:csv>)', this.#readingsObj)
    } catch (problem) {
      this.#db.$pool.end() // deinitialize db object even when insert fails
      throw problem
    }
    this.#db.$pool.end()
    return true
  }
}

const OwRec = new OwRecorder('./settings.ini')
OwRec.validateDbConnection()
  .then(() => OwRec.readOwParallell())
  .then(() => OwRec.insertIntoDb())
  .catch(problem => log(error(problem)))
