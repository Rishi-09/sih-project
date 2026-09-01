import { prisma } from "./client";

async function main() {
  const engines = [
    { tail: "UAV-01", model: "Rotax 915 iS, 4-cyl boxer, turbo, FADEC" },
    { tail: "UAV-02", model: "Rotax 915 iS, 4-cyl boxer, turbo, FADEC" },
    { tail: "UAV-03", model: "Rotax 915 iS, 4-cyl boxer, turbo, FADEC" },
  ];
  for (const e of engines) {
    await prisma.engine.upsert({ where: { tail: e.tail }, update: {}, create: e });
  }
  console.log("Seeded engines:", engines.map((e) => e.tail).join(", "));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
