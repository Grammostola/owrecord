# owrecord
Is a small nodejs script that attempts to read a set of onewire humidity and/or temperature sensors and then save the readings in a specified postgresql table. See below for table schema suggestion.

## Getting Started

### Prerequisites
An ow-server(https://www.owfs.org/) needs be accessible for sensor values to read, as well as a onewire network with sensors.



A PostgreSQL(15 tested) database table of a similar schema is needed to save values:

```sql
create table oca_temp_hum_hist(
    reading_nr bigint generated always as identity primary key,
    timestamp timestamptz,
    greenhouse_rel_hum numeric(3,0),
    greenhouse_temp numeric(3,1),
    balcony_rel_hum numeric(3,0),
    balcony_temp numeric(3,1));
```
Which is to say one row per run of the script.

The primary key column can be anything suitable (which ideally doesn't include the timestamp column). `timestamp` is required. The sensor read columns can be called anything but their type should be similar to the example.


### Installing
After cloning this repo and installing the dependencies edit **settings.json** with your database and ow sensors information, see the provided file for examples. The db `user` needs to have insert permission on the intended table.

The `id` property of a `sensorsColumns` object can be anything unique. The `sensorType` property can be `hum` for humidity and `temp` for temperature. (The `dbColumn` needs to match a db target table column, as per the example above).

The misc section of the settings file has two properties:
 ```json
  "miscSettings": {
    "readOnly": true,
    "sensorReadRetryDelay": 2
  }
  ```
`readOnly: true`, which is the default, will make the script read the sensors then output the results and halt, it will not attempt to connect to a database. (It makes sense to verify the sensor readings before attempting to store them.)

### Running
`node owrecord.js` will either read the specified sensors and output the result to the console or save them in the specified database table, depending on the `readOnly` setting. There's no output in a successful instance of the second scenario.

The settings.json file by default is assumed to reside in the script folder but a settings.json file with a different name or location can be supplied via a command line option:

```
node owrecord.js --c "../custom_schedules/nightly.json"
```

## Deployment
The script makes a certain amount of sense on a schedule. If systemd is employed the timer can look like so:
```
[Timer]
#Execute job if it missed a run due to machine being off
Persistent=true
#Every whole hour
OnCalendar=*-*-* *:00:00
#Defaults to 1 min..
AccuracySec=10s
Unit=owrecorder.service
```
(systemd gives itself a one minute leeway when executing jobs so without redefining that via AccuracySec=something less than a minute then the recording timestamps can become 20:01 21:01 22:01..)


## Code style

Standard js. 

Linting can be done via `npm run lint` and `npm run lint-fix`, for vscode there's a StandardJS extension for automatic formatting.  


## Contributing
Do create an issue for a feature request, bug report, comment or preceding a PR.

## License
MIT


