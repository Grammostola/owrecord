import util from 'util'
import { readFileSync } from 'fs'
import { parse } from 'ini'
import { Client } from 'owfs'
import chalk from 'chalk'
import database from './database.js'

const log = console.log
const error = chalk.red
const info = chalk.yellow

class OwRecorder {
  #settings = {}
  #db
  #readingsObj = {}
  constructor (settingsPath) {
    try {
      this.#settings = parse(readFileSync(settingsPath, 'utf-8'))
    } catch (problem) {
      log(error('Failed to read the settings file, by default \'settings.ini\' in the same location as owrecord.js'))
      throw problem
    }
    this.#db = database(this.#settings)

    this.validateDbConnection = this.validateDbConnection.bind(this)
    this.readOwParallell = this.readOwParallell.bind(this)
    this.insertIntoDb = this.insertIntoDb.bind(this)
  }

  async validateDbConnection () {
    const check = await this.#db.connect()
    check.done()
    return check.client.serverVersion
  }

  #formatSaveReadings (readingsArray, sensorsArray) {
    readingsArray.forEach((reading, index) => {
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
    })
  }

  async readOwParallell () {
    const owserverObj = this.#settings.owserver
    const sensorsArray = Object.entries(this.#settings.owsensors)
    const owConnection = new Client(owserverObj.Host, +owserverObj.Port)
    const owRead = util.promisify(owConnection.read.bind(owConnection))

    const readingsArray = await Promise.allSettled(sensorsArray.map(sensor => owRead(sensor[1])))

    if (readingsArray.some(reading => reading.status === 'rejected')) {
      const failureArray = []
      const delay = (1000 * (this.#settings?.retry_read_after?.seconds)) || 4000
      await new Promise(resolve => setTimeout(resolve, delay)) // pause, js style

      // need to remember the index of the failed readings in the readingsArray in order to later replace them
      readingsArray.forEach((reading, index) => {
        if (readingsArray[index].status === 'rejected') {
          failureArray.push([index, owRead(sensorsArray[index][1])])
        }
      })

      const retriedArray = await Promise.allSettled(failureArray.map(failure => failure[1]))

      // replace the relevant prior readings in the readingsArray after the second attempt
      retriedArray.forEach((reading, index) => {
        readingsArray[failureArray[index][0]] = retriedArray[index]
      })
    }

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

const OwRec = new OwRecorder(new URL('./settings_dev.ini', import.meta.url))
OwRec.validateDbConnection()
  .then(OwRec.readOwParallell)
  .then(OwRec.insertIntoDb)
  .catch(problem => log(error(problem)))
