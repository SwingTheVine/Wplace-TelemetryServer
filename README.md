## Telemetry Data
All user data is anonymous, even in the event of a database breach.
However, even if the user data was *not* anonymous, all user data that *could* be used to track players is destroyed after 1 hour. The PII that is stored is ephemeral.
Identifying you would require either:
* Access to your machine
* Access to the server for a long period of time

This is the data **recieved** by the server:
1. Your public IP address, which is viewable to everything your computer interacts with (e.g. wplace has your IP address)
2. A Unique User IDentification string (UUID)
3. Your Blue Marble version
4. Your browser type
5. Your Operating System type

This is the data **stored** by the server:
1. Your UUID
2. Your Blue Marble version
3. Your browser type
4. Your Operating System type
5. The time the request was sent

The stored data is deleted every hour, and is compiled into the following long-term storage:
* Total users (E.g. 58 Blue Marble users this hour)
* How many users of each type of Blue Marbler version (E.g. 1938 v1.0.0 users; 14 v0.91.0 users)
* How many users of each type of browser (E.g. 50 Chrome users; 24 Firefox users this hour)
* How many users of each type of operating system (E.g. 148 Edge users; 39 Windows users this hour)

The long-term storage is stripped of all PII. Therefore, the data can be considered ephemeral/anonymous.

## Why Do You Need This Data?
The telemetry data is currently used so I can:
1. Tell how many users have updated to the next version. Inversely, if a bunch of users are staying at a downgraded version, that speaks volumes about the compatibility of the next version up. For example, if the latest version is 0.83.0, and the version has been out for a week (the userscript auto-updates every 24 hours), it means the users running 0.81.0 are intentionally running version 0.81.0 because they encountered an issue with either 0.82.0 or 0.83.0.
2. The pure, anonymous user count per browser/OS. This tells me which browsers/OS work with Blue Marble. Inversely, if a popular browser/OS is *not* listed in the data, it means Blue Marble does not work on that browser/OS due to the [survivorship bias](https://en.wikipedia.org/wiki/Survivorship_bias) in the data. For example, if 0.5% of Blue Marble users are on Edge, this means Blue Marble does not work on Edge for most users because statistically, [5% of all internet users are on Edge](https://gs.statcounter.com/). This data shows that users are intentionally avoiding using Edge (and we can assume therefore that Blue Marble does not work on Edge)
3. Online users. This one is simple. If Blue Marble starts to break wplace, users will disable Blue Marble and the "Online Users" statistic will drop. Watching this statistic will allow me to respond quickly to major outages. This has happened in the past when the openfreemap endpoint was changed by wplace, and it broke the game for all Blue Marble users.

## Disclaimers
### Who has access to the server?
The server is hosted by ForceHost.
* SwingTheVine - The owner of Blue Marble
* Doerak - A founder & co-owner of ForceHost
* TheMG - A founder & co-owner of ForceHost
* Nagol - An executive of ForceHost

### What information can identify me?
At the very ***most***, the information can be used to discover:
* The time you play wplace (from the time the request was sent)
* The city you live in (from the IP address)

It is impossible to identify you anymore that that, from unlimited read/write access to *just* this telemetry server, and the data stored inside it.

### GDPR/CCPA
Please note that our telemetry system is designed to store personally identifiable information (PII) only for a maximum of 1 hour. After this period, all PII (including IP addresses and UUIDs) is automatically and permanently deleted from our server.

Because of this design:
* If your request is received **after the 1-hour retention window**, your data has already been deleted and no personal data exists on our server.
* If your request is received **within the 1-hour window**, your data will be deleted immediately upon your request.
* Your **request should include your UUID** so we can delete the data you requested. Your UUID can be found in the "Storage" tab. This tab is located inside "Blue Marble" inside the Tampermonkey browser extention.