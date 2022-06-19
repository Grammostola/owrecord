import util from 'util'
import { readFileSync } from 'fs'
import { parse } from 'ini'
import { Client } from 'owfs'
import chalk from 'chalk'
import database from './database.js'

const log = console.log
const error = chalk.red
const info = chalk.yellow

recordOw()
/**
 * Read specificed onewire temperature and humidity sensors and save in a table.
 * @param {string} iniPath - the path of the ini file with settings
 */
async function recordOw (iniPath = './settings.ini') {
  const settingsPath = new URL(iniPath, import.meta.url)
  const { settings, db } = await initialize(settingsPath)
  const readingsObj = await readOwParallell(settings)
  await insertIntoDb(settings, readingsObj, db)
}

async function initialize (settingsPath) {
  let settings
  try {
    settings = parse(readFileSync(settingsPath, 'utf-8'))
  } catch (problem) {
    log(error('Failed to read the settings file, by default \'settings.ini\' in the same location as owrecord.js'))
    throw problem
  }
  const db = database(settings)
  await validateDbConnection(db)
  return {
    settings,
    db
  }
}

async function validateDbConnection (db) {
  const check = await db.connect()
  check.done()
  return check.client.serverVersion
}

function formatSaveReadings (readingsArray, sensorsArray) {
  const readingsObj = {}
  readingsArray.forEach((reading, index) => {
    if (reading.status === 'fulfilled') {
      let value = +(reading.value)

      if (sensorsArray[index][0].endsWith('_humidity')) {
        value = Math.round(value)
      } else { // presumed _temperature
        value = +value.toFixed(2)
      }
      readingsObj[sensorsArray[index][0]] = value
    } else if (reading.status === 'rejected') {
      const now = new Date()
      log(info(`At ${now.toISOString()} reading the following onewire sensor failed: ${sensorsArray[index][1]}`))
      log(info(reading.reason + '\n')) // not critical if not all..then we shall at least receive a timestamp indicating an attempt was made
    }
  })
  return readingsObj
}

async function readOwParallell (settings) {
  const owserverObj = settings.owserver
  const sensorsArray = Object.entries(settings.owsensors)
  const owConnection = new Client(owserverObj.Host, +owserverObj.Port)
  const owRead = util.promisify(owConnection.read.bind(owConnection))

  const readingsArray = await Promise.allSettled(sensorsArray.map(sensor => owRead(sensor[1])))

  if (readingsArray.some(reading => reading.status === 'rejected')) {
    const failureArray = []
    const delay = (1000 * (settings?.retry_read_after?.seconds)) || 4000
    await new Promise(resolve => setTimeout(resolve, delay)) // pause, js style

    // need to remember the index of the failed readings in the readingsArray in order to later replace them
    readingsArray.forEach((reading, index) => {
      if (reading.status === 'rejected') {
        failureArray.push([index, owRead(sensorsArray[index][1])])
      }
    })

    const retriedArray = await Promise.allSettled(failureArray.map(failure => failure[1]))

    // replace the relevant prior readings in the readingsArray after the second attempt
    retriedArray.forEach((reading, index) => {
      readingsArray[failureArray[index][0]] = reading
    })
  }

  const readingsObj = formatSaveReadings(readingsArray, sensorsArray)

  const now = new Date()
  if (Object.keys(readingsObj).length === 0) {
    log(info(`At ${now.toISOString()} all sensor readings failed.\n`))
  }

  readingsObj.timestamp = now
  return readingsObj
}

async function insertIntoDb (settings, readingsObj, db) {
  try {
    await db.none('INSERT INTO ' + settings.postgresql.Table + '($<this:name>) VALUES($<this:csv>)', readingsObj)
  } catch (problem) {
    db.$pool.end() // deinitialize db object even when insert fails
    throw problem
  }
  db.$pool.end()
}
