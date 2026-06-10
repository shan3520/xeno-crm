import { Prisma } from "@prisma/client";

/**
 * JSON-safe order + item shapes. Decimal money -> string (fixed 2dp); timestamps -> ISO.
 * Consumers parse totalAmount / unitPrice as decimal strings, never floats.
 */
export interface OrderItemResponse {
  id: string;
  productName: string;
  sku: string | null;
  category: string | null;
  quantity: number;
  unitPrice: string;
}

export interface OrderResponse {
  id: string;
  externalId: string;
  customerId: string;
  totalAmount: string;
  currency: string;
  status: string;
  orderedAt: string;
  createdAt: string;
  items: OrderItemResponse[];
}

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

export function mapOrder(order: OrderWithItems): OrderResponse {
  return {
    id: order.id,
    externalId: order.externalId,
    customerId: order.customerId,
    totalAmount: order.totalAmount.toFixed(2),
    currency: order.currency,
    status: order.status,
    orderedAt: order.orderedAt.toISOString(),
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      sku: item.sku,
      category: item.category,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toFixed(2),
    })),
  };
}
