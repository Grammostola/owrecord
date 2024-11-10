import pgPromise from 'pg-promise'

const pgp = pgPromise({})
const database = function (settings) {
  const cd = {
    user: settings.user,
    host: settings.host,
    pass: settings.pass,
    database: settings.db,
    port: settings.port
  }

  const cn = `postgres://${cd.user}:${cd.pass}@${cd.host}:${cd.port}/${cd.database}`
  const db = pgp(cn)
  return {
    db,
    pgp
  }
}

export default database
