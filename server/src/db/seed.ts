import { prisma } from "./client";

async function main() {
  const defaultEngine = {
    tail: "UAV-01",
    model: "Rotax 915 iS, 4-cyl boxer, turbo, FADEC",
  };

  await prisma.engine.upsert({
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
  .finally(() => prisma.$disconnect());
