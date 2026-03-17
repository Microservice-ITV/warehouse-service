export interface ProductEventData {
  product_id: string;
  slug?: string;
  title?: string;
  description?: string | null;
  sku?: string;
  price?: number;
  stock?: number;
  currency?: string;
  category_id?: string;
  shop_id: string;
  images?: string[];
  image_url?: string | null;
  is_active?: boolean;
}

export interface ShopEventData {
  shop_id: string;
  name?: string;
  slug?: string;
  description?: string | null;
  is_active?: boolean;
}

export interface ProductCreatedEvent {
  event_id: string;
  event: 'product.created';
  correlation_id?: string;
  producer?: string;
  data: ProductEventData;
}

export interface ProductUpdatedEvent {
  event_id: string;
  event: 'product.updated';
  correlation_id?: string;
  producer?: string;
  data: ProductEventData;
}

export interface ProductDeletedEvent {
  event_id: string;
  event: 'product.deleted';
  correlation_id?: string;
  producer?: string;
  data: {
    product_id: string;
  };
}

export interface ShopCreatedEvent {
  event_id: string;
  event: 'shop.created';
  correlation_id?: string;
  producer?: string;
  data: ShopEventData;
}

export interface ShopUpdatedEvent {
  event_id: string;
  event: 'shop.updated';
  correlation_id?: string;
  producer?: string;
  data: ShopEventData;
}

export interface ShopDeletedEvent {
  event_id: string;
  event: 'shop.deleted';
  correlation_id?: string;
  producer?: string;
  data: {
    shop_id: string;
  };
}

export interface OrderCreatedEvent {
  event_id: string;
  event: 'order.created';
  correlation_id?: string;
  producer?: string;
  data: {
    order_id?: string | null;
    checkout_id: string;
    expires_at: string;
    items: Array<{
      product_id: string;
      qty: number;
      shop_id: string;
    }>;
  };
}

export interface OrderPaidEvent {
  event_id: string;
  event: 'order.paid';
  correlation_id?: string;
  producer?: string;
  data: {
    order_id?: string;
    checkout_id: string;
    reservation_id?: string;
  };
}

export interface OrderCancelledEvent {
  event_id: string;
  event: 'order.cancelled';
  correlation_id?: string;
  producer?: string;
  data: {
    order_id?: string;
    checkout_id: string;
    reservation_id?: string;
  };
}
