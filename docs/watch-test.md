# Does a Bee todo alarm reach the Apple Watch?

Protocol (19 Oct 2026, owner's real account, Apple Watch as the only Bee device):
1. `todos.create({ text: "Thoughtful test: did your watch tap?", alarmAt: <now + 3 min, ISO UTC> })` through `@beeai/cli/lib`.
2. iPhone locked, watch on the wrist; the owner notes what happens at the alarm time.

| Run | Alarm (Paris) | iPhone | Apple Watch | Text shown | Notes |
|---|---|---|---|---|---|
| 1 | 17:00 | pending | pending | pending | todo created in 1.1 s; `alarm_at` returned in ms; no `todo-created` stream event |

Thoughtful's design does not depend on the answer: reminders are Bee todos (they show in the Bee app and on the watch list in any case), and the evening card works without any notification.
