# Test Credentials

Auth: Emergent Google OAuth (no passwords). Sessions seeded directly in Mongo for testing.
Cookie name: `session_token` (httpOnly, secure, sameSite=None). Also accepted as `Authorization: Bearer <token>`.

## Seeded test accounts (db: test_database)

| Role | Name | Email | session_token |
|---|---|---|---|
| Professor | Dr. Ada Reyes | prof@school.edu | test_session_prof_1 |
| Student | Sam Carter | student@school.edu | test_session_stud_1 |

To (re)create, run:
```
mongosh --quiet --eval '
use("test_database");
db.users.updateOne({user_id:"test-prof-1"},{$set:{user_id:"test-prof-1",email:"prof@school.edu",name:"Dr. Ada Reyes",role:"professor",created_at:new Date().toISOString()}},{upsert:true});
db.users.updateOne({user_id:"test-stud-1"},{$set:{user_id:"test-stud-1",email:"student@school.edu",name:"Sam Carter",role:"student",created_at:new Date().toISOString()}},{upsert:true});
var exp=new Date(Date.now()+7*864e5).toISOString();
db.user_sessions.updateOne({session_token:"test_session_prof_1"},{$set:{user_id:"test-prof-1",session_token:"test_session_prof_1",expires_at:exp,created_at:new Date().toISOString()}},{upsert:true});
db.user_sessions.updateOne({session_token:"test_session_stud_1"},{$set:{user_id:"test-stud-1",session_token:"test_session_stud_1",expires_at:exp,created_at:new Date().toISOString()}},{upsert:true});
'
```

Seeded demo course: "Intro to Political Theory" (join code visible on professor course page).
