import util from 'util'
import { readFile } from 'fs/promises'
import { Client } from 'owfs'
import colors from 'yoctocolors'
import databaseObj from './database.js'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

const argv = yargs(hideBin(process.argv))
  .option('config', {
    alias: 'c',
    describe: 'Path of the intended config.json',
    type: 'string',
    default: './settings.json'
  }).help().argv

const log = console.log

recordOw(argv.c).catch(error => log(`There was an error while running the owrecord script:
   ${colors.red(error)}`))
/**
 * Read specificed onewire temperature and humidity sensors and save in a table.
 * @param {string} settingsJsonPath - the path of the settings file
 */
async function recordOw (settingsJsonPath) {
  const settingsPath = new URL(settingsJsonPath, import.meta.url)
  const settingsObjString = await readSettings(settingsPath)
  const settingsObj = JSON.parse(settingsObjString)

  const owConnection = new Client(settingsObj.owserver.host, settingsObj.owserver.port)
  const owReadFunc = util.promisify(owConnection.read.bind(owConnection))

  const valuesColumns = await getOwResults(settingsObj.sensorsColumns)

  if (valuesColumns.every(value => value.result === undefined)) {
    return Promise.reject(new Error('No sensor was successfully read, script run ended.'))
  }

  if (settingsObj.miscSettings.readOnly === true) {
    valuesColumns.forEach(sensor => {
      const valueColor = sensor.result ? colors.green : colors.dim
      log(`Sensor ${colors.yellow(sensor.id)} returned the value ${valueColor(sensor.result)}. `) // undefined logically means problem
    })
  } else {
    const { db, pgp } = await initDbConn(settingsObj.database)
    const resultsObj = createInsertObject(valuesColumns)

    valuesColumns.forEach(value => {
      if (!(value.result)) console.log(colors.yellow(`Failed to read sensor ${colors.bold(value.id)}`))
    })

    insertIntoDb({ table: settingsObj.database.table, db, pgp, insertObj: resultsObj })
  }

  async function readSettings (settingsPath) {
    let settingsObj
    try {
      settingsObj = await readFile(settingsPath, 'utf-8')
    } catch (problem) {
      log('Failed to read the settings file, by default \'settings.json\' in the same location as owrecord.js')
      throw problem
    }
    return settingsObj
  }

  async function initDbConn (settings) {
    const { db, pgp } = databaseObj(settings)
    const check = await db.connect()
    check.done()
    return { db, pgp }
  }

  function getResultObj ({ sensor, data, status }) {
    const now = new Date()
    return {
      id: sensor.id,
      time: now,
      data,
      status
    }
  }

  async function readSensors (sensors) {
    // console.time('readSensors')
    const results = await Promise.all(sensors.map(sensor => {
      return owReadFunc(sensor.owAddress).then(
        data => {
          return getResultObj({ sensor, data, status: 'fulfilled' })
        },
        error => {
          return getResultObj({ sensor, error, status: 'rejected' })
        }
      )
    }))
    // console.timeEnd('readSensors')
    return results
  }

  async function getOwResults (sensors) {
    const results = await readSensors(sensors)
    if (results.some((result) => result.status === 'rejected')) {
      const delay = (1000 * (settingsObj.miscSettings.sensorReadRetryDelay)) || 2000
      await new Promise(resolve => setTimeout(resolve, delay)) // pause, js style

      const failedSensors = sensors.filter((sensor) => {
        return results.find(result => (result.id === sensor.id) && (result.status === 'rejected'))
      })

      const secondResults = await readSensors(failedSensors)

      const secondSuccessfulResults = secondResults.filter(result => result.status === 'fulfilled')
      if (secondSuccessfulResults.length > 0) {
        secondSuccessfulResults.forEach(success => {
          const replaceeIndex = results.findIndex(result => result.id === success.id)
          results[replaceeIndex] = success
        })
      }
    }

    const sensorsWithResults = sensors.map(sensor => {
      const matchedResult = results.find(result => result.id === sensor.id)
      return {
        ...sensor,
        result: matchedResult.data,
        time: matchedResult.time
      }
    })
    return sensorsWithResults
  }

  function createInsertObject (resultsArray) {
    const timestamp = resultsArray[resultsArray.length - 1].time.toISOString()
    return resultsArray.reduce((acc, result) => {
      if (result.result) {
        if (result.sensorType === 'hum') {
          acc[result.dbColumn] = Math.round(+result.result)
        } else if (result.sensorType === 'temp') {
          acc[result.dbColumn] = Math.round(result.result * 10) / 10
        } else {
          acc[result.dbColumn] = result.result
        }
        acc.timestamp = timestamp
      }
      return acc
    }, {})
  }

  async function insertIntoDb ({ table, db, pgp, insertObj }) {
    try {
      const { insert } = pgp.helpers
      const insertStatement = insert(insertObj, null, table)
      await db.none(insertStatement, insertObj)
    } catch (problem) {
      db.$pool.end() // deinitialize db object even when insert fails
      throw problem
    }
    db.$pool.end()
  }
}
