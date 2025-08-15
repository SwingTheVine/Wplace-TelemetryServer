## Storage
All user data is anonymous, even in the event of a database breach.
However, even if the user data was *not* anonymous, all user data that *could* be used to track players is destroyed after 1 hour.
Identifying you would require access to your machine.

This is the data **recieved** by the server:
* A Unique User IDentification string (UUID)
* Your browser type
* Your Operating System type

This is the data **stored** by the server:
* Your UUID
* Your browser type
* Your Operating System type
* The time the request was sent

The stored data is deleted every 1 hour, and is compiled into the following long-term storage:
* Total users (E.g. 58 Blue Marble users this hour)
* How many of each type of browser (E.g. 50 Chrome users; 24 Firefox users this hour)
* How many of each type of operating system (E.g. 148 Edge users; 39 Windows users this hour)
