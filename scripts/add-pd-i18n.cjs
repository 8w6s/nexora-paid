const fs = require("fs");
const path = require("path");

const ADDS = {
  de: {
    sold: "{count} verkauft",
    choosePackage: "Paket wählen",
    outOfStockShort: "Ausverkauft",
    relatedProducts: "Ähnliche Produkte",
    instantDeliveryTitle: "Sofortlieferung",
    instantDeliverySub: "Schlüssel werden nach Zahlung automatisch gesendet",
    securePaymentTitle: "Sichere Zahlung",
    securePaymentSub: "Bezahle mit Litecoin, abgerechnet on-chain",
    alwaysAvailableTitle: "Immer verfügbar",
    alwaysAvailableSub: "Sieh deine Schlüssel jederzeit in „Meine Bestellungen“ ein",
    reviewsTitle: "Bewertungen",
    verifiedOnly: "Nur verifizierte Käufer können eine Bewertung hinterlassen.",
    noReviews: "Noch keine Bewertungen. Sei der Erste, der seine Meinung teilt.",
  },
  en: {
    sold: "{count} sold",
    choosePackage: "Choose Package",
    outOfStockShort: "Out of Stock",
    relatedProducts: "Related products",
    instantDeliveryTitle: "Instant delivery",
    instantDeliverySub: "Keys sent automatically after payment",
    securePaymentTitle: "Secure payment",
    securePaymentSub: "Pay in Litecoin, settled on-chain",
    alwaysAvailableTitle: "Always available",
    alwaysAvailableSub: "Re-view your keys anytime in My Orders",
    reviewsTitle: "Reviews",
    verifiedOnly: "Only verified buyers can leave a review.",
    noReviews: "No reviews yet. Be the first to share your thoughts.",
  },
  vi: {
    sold: "Đã bán {count}",
    choosePackage: "Chọn gói",
    outOfStockShort: "Hết hàng",
    relatedProducts: "Sản phẩm liên quan",
    instantDeliveryTitle: "Giao hàng tức thì",
    instantDeliverySub: "Key được gửi tự động sau khi thanh toán",
    securePaymentTitle: "Thanh toán an toàn",
    securePaymentSub: "Thanh toán bằng Litecoin, xử lý on-chain",
    alwaysAvailableTitle: "Luôn sẵn sàng",
    alwaysAvailableSub: "Xem lại key bất cứ lúc nào trong Đơn của tôi",
    reviewsTitle: "Đánh giá",
    verifiedOnly: "Chỉ người mua đã xác thực mới có thể để lại đánh giá.",
    noReviews: "Chưa có đánh giá. Hãy là người đầu tiên chia sẻ cảm nhận.",
  },
  zh: {
    sold: "已售 {count}",
    choosePackage: "选择套餐",
    outOfStockShort: "缺货",
    relatedProducts: "相关商品",
    instantDeliveryTitle: "即时发货",
    instantDeliverySub: "付款后自动发送密钥",
    securePaymentTitle: "安全支付",
    securePaymentSub: "使用莱特币支付，链上结算",
    alwaysAvailableTitle: "随时可用",
    alwaysAvailableSub: "随时在「我的订单」中查看您的密钥",
    reviewsTitle: "评价",
    verifiedOnly: "仅已验证的买家可以留下评价。",
    noReviews: "还没有评价。来做第一个分享想法的人吧。",
  },
  es: {
    sold: "{count} vendidos",
    choosePackage: "Elegir paquete",
    outOfStockShort: "Agotado",
    relatedProducts: "Productos relacionados",
    instantDeliveryTitle: "Entrega instantánea",
    instantDeliverySub: "Las claves se envían automáticamente tras el pago",
    securePaymentTitle: "Pago seguro",
    securePaymentSub: "Paga en Litecoin, liquidado on-chain",
    alwaysAvailableTitle: "Siempre disponible",
    alwaysAvailableSub: "Consulta tus claves en cualquier momento en Mis pedidos",
    reviewsTitle: "Reseñas",
    verifiedOnly: "Solo los compradores verificados pueden dejar una reseña.",
    noReviews: "Aún no hay reseñas. Sé el primero en compartir tu opinión.",
  },
};

const root = path.join(__dirname, "..", "frontend", "src", "i18n", "locales");

for (const [loc, ads] of Object.entries(ADDS)) {
  const file = path.join(root, loc + ".json");
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  j.storefront = j.storefront || {};
  j.storefront.product = j.storefront.product || {};
  Object.assign(j.storefront.product, ads);
  fs.writeFileSync(file, JSON.stringify(j, null, 2) + "\n");
  console.log(loc, "ok");
}