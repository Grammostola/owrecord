import pgPromise from 'pg-promise'

const pgp = pgPromise({})
const database = function (settings) {
  const cd = {
    user: settings.postgresql.User,
    host: settings.postgresql.Host,
    pass: settings.postgresql.Pass,
    database: settings.postgresql.DB,
    port: settings.postgresql.Port
  }

  const cn = `postgres://${cd.user}:${cd.pass}@${cd.host}:${cd.port}/${cd.database}`
  const db = pgp(cn)
  return db
}

export default database
