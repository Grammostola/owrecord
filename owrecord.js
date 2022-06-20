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
  const readingsObj = await readOwSerially(settings)
  if (settings?.strategy?.readonly) {
    log(readingsObj)
  } else await insertIntoDb(settings, readingsObj, db)
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

async function readOwSerially (settings) {
  const owObject = {
    server: settings.owserver,
    sensors: settings.owsensors
  }

  const owConnection = new Client(owObject.server.Host, +owObject.server.Port)
  const owRead = util.promisify(owConnection.read.bind(owConnection))

  let readErrors = false

  for (const sensor in owObject.sensors) {
    let value
    try {
      value = await owRead(owObject.sensors[sensor])
    } catch (error) {
      value = 'read error'
      readErrors = true
    }

    owObject.sensors[sensor] = {
      type: sensor.slice(sensor.lastIndexOf('_') + 1),
      address: owObject.sensors[sensor],
      reading: value
    }
  }

  if (readErrors) {
    const delay = (1000 * (settings?.retry_read_after?.seconds)) || 4000
    await new Promise(resolve => setTimeout(resolve, delay)) // pause, js style

    for (const sensor in owObject.sensors) {
      let value
      const curSensor = owObject.sensors[sensor]
      if (curSensor.reading === 'read error') {
        try {
          value = await owRead(owObject.sensors[sensor].address)
          curSensor.reading = value
        } catch (error) {
          const now = new Date()
          log(info(`At ${now.toLocaleString()} reading the following onewire sensor failed: ${sensor}`))
        }
      }
    }
  }
  return _createInsertObject(owObject)
}

function _createInsertObject (owObject) {
  const insertObject = {}
  for (const sensor in owObject.sensors) {
    const curSensor = owObject.sensors[sensor]
    if (!(curSensor.reading === 'read error')) {
      const value = +owObject.sensors[sensor].reading
      if (curSensor.type === 'humidity') {
        insertObject[sensor] = Math.round(value)
      } else if (curSensor.type === 'temperature') {
        insertObject[sensor] = (+value.toFixed(2))
      } else {
        insertObject[sensor] = value
      }
    }
  }
  if (Object.keys(insertObject).length === 0) {
    throw Error('All sensor readings failed.')
  }
  const timestamp = new Date()
  insertObject.timestamp = timestamp.toISOString()
  return insertObject
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
