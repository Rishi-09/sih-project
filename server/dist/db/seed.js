"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("./client");
async function main() {
    const defaultEngine = {
        tail: "UAV-01",
        model: "Rotax 915 iS, 4-cyl boxer, turbo, FADEC",
    };
    await client_1.prisma.engine.upsert({
        where: { tail: defaultEngine.tail },
        update: {},
        create: defaultEngine,
    });
    console.log("Seeded initial aircraft simulator:", defaultEngine.tail);
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => client_1.prisma.$disconnect());
//# sourceMappingURL=seed.js.map