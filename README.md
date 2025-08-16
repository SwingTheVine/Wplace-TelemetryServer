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

## Disclaimers
### Who has access to the server?
The server is hosted by ForceHost.
* SwingTheVine - The owner of Blue Marble
* Doerak - A founder & co-owner of ForceHost
* TheMG - A founder & co-owner of ForceHost
* Nagol - An executive of ForceHost and a **moderator of wplace**

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