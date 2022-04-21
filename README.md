# owrecord
Is a small nodejs script that attempts to read user-defined onewire humidity and temperature sensors and then save the readings in a postgresql table. It carries no extra bits.

## Getting Started

### Prerequisites
An ow-server(https://www.owfs.org/) needs be accessible for sensor values to read, as well as a onewire network with sensors.



A PostgreSQL(13 tested) database table of a similar format is needed to save values:

```sql
create table ow_2022(
    reading_nr bigint generated always as identity primary key,
    timestamp timestamptz,
    southside_rel_humidity numeric(3,0),
    southside_temperature numeric(3,1),
    greenhouse_rel_humidity numeric(3,0),
    greenhouse_temperature numeric(3,1),
    balcony_rel_humidity numeric(3,0),
    balcony_temperature numeric(3,1));
```
The primary key column can be anything suitable (which doesn't ideally include the timestamp column) and the _temperature and _humidity columns need to match sensor designations (and probably function), see below. The timestamp will be from the timezone of the executing javascript environment.


### Installing
After cloning this repo edit **settings.ini** with your database and sensors information. The names need to match, so a sensor called "west_rel_humidity" in settings.ini needs a "west_rel_humidity" numeric(3,0) column in the target table.


Therafter the script can be run:
```
node owrecord.js
```
If there's no visible output then it has probably run successfully, check the database table.




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

(I've only gotten a user job to run on a headless server and without logging in by enabling lingering for the user account)

## Code style

Standard js. 

Linting can be done via `npm run lint` and `npm run lint-fix`, for vscode there's a StandardJS extension for automatic formatting.  


## Contributing
Do create an issue for a feature request, bug report, comment or preceding a PR.

## License
MIT


