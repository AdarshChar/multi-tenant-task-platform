// backend/tests/api.test.js
const request = require("supertest");
const app = require("../app");

describe("Full-Stack API Integration Test Suite", () => {
    let user1Token;
    let user1TaskId;
    let user2Token;

    const testUser1 = {
        email: `test_user1_${Date.now()}@example.com`,
        password: "password123",
    };

    const testUser2 = {
        email: `test_user2_${Date.now()}@example.com`,
        password: "password123",
    };

    //Authentication and token generation

    describe("Auth Routes", () => {
        it("POST /api/auth/register should create a user and return a signed JWT", async () => {
            const res = await request(app)
                .post("/api/auth/register")
                .send(testUser1);

            expect(res.status).toBe(201);
            expect(res.body).toHaveProperty("token");
            expect(res.body.user).toHaveProperty("id")
            expect(res.body.user.email).toBe(testUser1.email.toLowerCase());

            user1Token = res.body.token; //Save token for future tests
        });

        it("POST /api/auth.login should return a token for valid credentials", async () => {
            const res = await request(app)
                .post("/api/auth/login")
                .send(testUser1)

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty("token");
        });

        it("POST /api/auth/login should reject invalid passwords with  401", async () => {
            const res = await request(app)
                .post("/api/auth/login")
                .send({ email: testUser1.email, password: "wrongpassword" });
            
            expect(res.status).toBe(401);
            expect(res.body).toHaveProperty("error", "Invalid email or password");
        });
    });

    // Protected routes and IDOR Isolation

    describe("Protected Task Routes and IDOR Boundary", () => {
        it("GET /api/tasks should return 401 when no token is provided", async() => {
            const res = await request(app).get("/api/tasks");
            expect(res.status).toBe(401);

        });

        it("GET /api/tasks should return 401 when an invalid/tampered token is provided", async() => {
            const res = await request(app)
                .get("/api/tasks")
                .set("Authorization", "Bearer invalid.fake.token");

            expect(res.status).toBe(401);
        });

        it("POST /api/tasks should create a task scoped to the authenticated user", async() => {
            const res = await request(app)
                .post("/api/tasks")
                .set("Authorization", `Bearer ${user1Token}`)
                .send({ title: "User 1 Private Task", description: "Secret notes" });

            expect(res.status).toBe(201);
            expect(res.body.title).toBe("User 1 Private Task");
            user1TaskId = res.body.id; // Save task ID for IDOR assertion

            
        });

        it("(DELETE) /api/tasks/:id should prevent IDOR (User 2 cannot delete User 1's task)", async () => {
            // Register User 2
            const regRes = await request(app)
                .post("/api/auth/register")
                .send(testUser2);
            user2Token = regRes.body.token;

            // User 2 tries to delete User 1's task
            const attackRes = await request(app)
                .delete(`/api/tasks/${user1TaskId}`)
                .set("Authorization", `Bearer ${user2Token}`);

            // Query scopes by WHERE id = ? AND user_id = ?
            // 0 rows affected -> API respons with 404 Not Found

            expect(attackRes.status).toBe(404);

            // Verify task still exists for User 1
            const checkRes = await request(app)
                .get("/api/tasks")
                .set("Authorization", `Bearer ${user1Token}`);

            const exists = checkRes.body.some((task) => task.id === user1TaskId);
            expect(exists).toBe(true);
        });    
    });

    // Rate Limiting Egress and Throttling
describe("Rate Limiter Middleware", () => {
    it("POST /api/auth/login should throttle and return 429 + Retry-After on quota breach", async () => {
      const badCreds = { email: "spammer@example.com", password: "badpassword" };

      // authLimiter quota is 5 requests per 15 minutes.
      // Fire requests 1 through 5 (they will fail with 401, but consume rate quota):
      for (let i = 0; i < 5; i++) {
        await request(app).post("/api/auth/login").send(badCreds);
      }

      // The 6th request breaches the threshold:
      const blockedRes = await request(app)
        .post("/api/auth/login")
        .send(badCreds);

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.headers).toHaveProperty("retry-after");
      expect(blockedRes.headers).toHaveProperty("ratelimit-remaining", "0");
      expect(blockedRes.body.error).toMatch(/Too many authentication attempts/);
    });
  });
});


