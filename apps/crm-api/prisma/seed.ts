/**
 * Idempotent demo seed for ONE workspace ("Looms — D2C apparel").
 *
 * - Fixed faker seed => reproducible data.
 * - Clears child -> parent (FK-safe), then bulk-inserts via chunked createMany.
 * - ~2,000 customers, ~6,000 orders with items across 5 categories.
 * - Denormalized customer stats (totalSpend/orderCount/firstOrderAt/lastOrderAt) are
 *   computed from the generated orders so they always agree.
 * - Communications / events / campaigns are left empty (produced by running the loop).
 * - Guarantees a meaningful "lapsed sneaker buyers" cohort for the demo scenario.
 */
import { faker } from "@faker-js/faker";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const WORKSPACE_ID = "looms-workspace";
const WORKSPACE_NAME = "Looms — D2C apparel";
const NUM_CUSTOMERS = 2000;

const DAY_MS = 86_400_000;
const NOW = new Date();
const daysAgo = (d: number): Date => new Date(NOW.getTime() - d * DAY_MS);
const pad = (n: number): string => String(n).padStart(6, "0");

const CITIES = [
  "Mumbai",
  "Delhi",
  "Bengaluru",
  "Hyderabad",
  "Chennai",
  "Pune",
  "Kolkata",
  "Ahmedabad",
  "Jaipur",
  "Surat",
];

const TAG_POOL = [
  "newsletter",
  "app_user",
  "sale_hunter",
  "loyalty",
  "gift_buyer",
  "returns_frequent",
];

// category -> realistic INR price band, in paise (integer money; never floats).
const CATEGORY_PRICES: Record<string, { min: number; max: number }> = {
  sneakers: { min: 250_000, max: 800_000 },
  tees: { min: 50_000, max: 150_000 },
  denim: { min: 150_000, max: 400_000 },
  outerwear: { min: 250_000, max: 900_000 },
  accessories: { min: 30_000, max: 250_000 },
};
const CATEGORIES = Object.keys(CATEGORY_PRICES);

const paiseToDecimalString = (paise: number): string =>
  (paise / 100).toFixed(2);

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(rows.slice(i, i + size));
  }
  return out;
}

interface CustomerRow {
  id: string;
  workspaceId: string;
  externalId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  attributes: { city: string; tier: string; tags: string[] };
  totalSpend: string;
  orderCount: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
}

interface OrderRow {
  id: string;
  workspaceId: string;
  customerId: string;
  externalId: string;
  totalAmount: string;
  currency: string;
  status: string;
  orderedAt: Date;
}

interface OrderItemRow {
  id: string;
  orderId: string;
  productName: string;
  sku: string | null;
  category: string | null;
  quantity: number;
  unitPrice: string;
}

async function clearWorkspaceData(): Promise<void> {
  // Child -> parent so foreign keys never block a delete.
  await prisma.communicationEvent.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany(); // clears Attribution FK to Communication first
  await prisma.communication.deleteMany();
  await prisma.chatMessage.deleteMany();
  await prisma.chatThread.deleteMany();
  await prisma.aiTaskLog.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.segment.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.workspace.deleteMany();
}

function pickOrderCount(): number {
  return faker.helpers.weightedArrayElement([
    { weight: 10, value: 0 },
    { weight: 18, value: 1 },
    { weight: 20, value: 2 },
    { weight: 18, value: 3 },
    { weight: 14, value: 4 },
    { weight: 9, value: 5 },
    { weight: 6, value: 6 },
    { weight: 3, value: 8 },
    { weight: 2, value: 10 },
  ]);
}

// Days-ago window for a customer's MOST RECENT order. Weighted to leave a healthy
// 60+ day lapsed population (incl. lapsed sneaker buyers) for the demo.
function pickLastOrderWindow(): [number, number] {
  return faker.helpers.weightedArrayElement([
    { weight: 24, value: [1, 30] as [number, number] }, // recent
    { weight: 18, value: [31, 60] as [number, number] }, // lapsing
    { weight: 22, value: [61, 120] as [number, number] }, // lapsed 60-120
    { weight: 16, value: [121, 240] as [number, number] }, // lapsed 120-240
    { weight: 12, value: [241, 540] as [number, number] }, // long lapsed
  ]);
}

function pickCategory(): string {
  return faker.helpers.weightedArrayElement([
    { weight: 28, value: "sneakers" },
    { weight: 26, value: "tees" },
    { weight: 18, value: "denim" },
    { weight: 12, value: "outerwear" },
    { weight: 16, value: "accessories" },
  ]);
}

function pickQuantity(): number {
  return faker.helpers.weightedArrayElement([
    { weight: 70, value: 1 },
    { weight: 20, value: 2 },
    { weight: 8, value: 3 },
    { weight: 2, value: 4 },
  ]);
}

async function main(): Promise<void> {
  // Deterministic data on every run.
  faker.seed(20240601);

  console.log("Clearing existing data (idempotent reseed)…");
  await clearWorkspaceData();

  await prisma.workspace.create({
    data: { id: WORKSPACE_ID, name: WORKSPACE_NAME },
  });

  const customers: CustomerRow[] = [];
  const orders: OrderRow[] = [];
  const items: OrderItemRow[] = [];

  let orderSeq = 0;
  let itemSeq = 0;
  let lapsedSneakerBuyers = 0;

  for (let i = 0; i < NUM_CUSTOMERS; i++) {
    const id = `cust_${pad(i)}`;
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const email = `${firstName}.${lastName}.${i}@example.com`
      .toLowerCase()
      .replace(/[^a-z0-9.@]/g, "");
    const phone = faker.helpers.maybe(() => faker.phone.number(), {
      probability: 0.7,
    });
    const tier = faker.helpers.weightedArrayElement([
      { weight: 40, value: "bronze" },
      { weight: 30, value: "silver" },
      { weight: 20, value: "gold" },
      { weight: 10, value: "platinum" },
    ]);
    const attributes = {
      city: faker.helpers.arrayElement(CITIES),
      tier,
      tags: faker.helpers.arrayElements(TAG_POOL, { min: 0, max: 3 }),
    };

    const n = pickOrderCount();

    let totalPaise = 0;
    let firstOrderAt: Date | null = null;
    let lastOrderAt: Date | null = null;
    let boughtSneakers = false;

    if (n > 0) {
      const [lo, hi] = pickLastOrderWindow();
      const lastDaysAgo = faker.number.int({ min: lo, max: hi });
      const spanDays = faker.number.int({ min: n * 12, max: 540 });

      // First order date for this customer is the oldest; most recent sits in the window.
      const orderDayOffsets = [lastDaysAgo];
      for (let k = 1; k < n; k++) {
        orderDayOffsets.push(
          faker.number.int({ min: lastDaysAgo, max: lastDaysAgo + spanDays }),
        );
      }

      for (const offset of orderDayOffsets) {
        const orderedAt = daysAgo(offset);
        const orderId = `order_${pad(orderSeq)}`;
        const itemCount = faker.number.int({ min: 1, max: 4 });

        let orderPaise = 0;
        for (let it = 0; it < itemCount; it++) {
          const category = pickCategory();
          if (category === "sneakers") boughtSneakers = true;
          const band = CATEGORY_PRICES[category]!;
          const unitPaise = faker.number.int({ min: band.min, max: band.max });
          const quantity = pickQuantity();
          orderPaise += unitPaise * quantity;

          items.push({
            id: `oi_${pad(itemSeq)}`,
            orderId,
            productName: `${faker.commerce.productAdjective()} ${category}`,
            sku: `SKU-${category.slice(0, 3).toUpperCase()}-${pad(itemSeq)}`,
            category,
            quantity,
            unitPrice: paiseToDecimalString(unitPaise),
          });
          itemSeq++;
        }

        orders.push({
          id: orderId,
          workspaceId: WORKSPACE_ID,
          customerId: id,
          externalId: `ORD-${pad(orderSeq)}`,
          totalAmount: paiseToDecimalString(orderPaise),
          currency: "INR",
          status: "paid",
          orderedAt,
        });
        orderSeq++;

        totalPaise += orderPaise;
        if (firstOrderAt === null || orderedAt < firstOrderAt) {
          firstOrderAt = orderedAt;
        }
        if (lastOrderAt === null || orderedAt > lastOrderAt) {
          lastOrderAt = orderedAt;
        }
      }
    }

    if (
      boughtSneakers &&
      lastOrderAt !== null &&
      lastOrderAt.getTime() < daysAgo(60).getTime()
    ) {
      lapsedSneakerBuyers++;
    }

    customers.push({
      id,
      workspaceId: WORKSPACE_ID,
      externalId: `CUST-${pad(i)}`,
      firstName,
      lastName,
      email,
      phone: phone ?? null,
      attributes,
      totalSpend: paiseToDecimalString(totalPaise),
      orderCount: n,
      firstOrderAt,
      lastOrderAt,
    });
  }

  console.log(
    `Inserting ${customers.length} customers, ${orders.length} orders, ${items.length} order items…`,
  );

  const BATCH = 1000;
  for (const part of chunk(customers, BATCH)) {
    await prisma.customer.createMany({ data: part });
  }
  for (const part of chunk(orders, BATCH)) {
    await prisma.order.createMany({ data: part });
  }
  for (const part of chunk(items, BATCH)) {
    await prisma.orderItem.createMany({ data: part });
  }

  console.log("Seed complete:");
  console.log(`  workspace:           ${WORKSPACE_NAME} (${WORKSPACE_ID})`);
  console.log(`  customers:           ${customers.length}`);
  console.log(`  orders:              ${orders.length}`);
  console.log(`  order items:         ${items.length}`);
  console.log(`  lapsed sneaker buyers (sneakers, lastOrderAt > 60d): ${lapsedSneakerBuyers}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
