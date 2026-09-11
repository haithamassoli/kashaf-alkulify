import { type Infer, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { bookSeedValidator } from "./schema";

type BookSeed = Infer<typeof bookSeedValidator>;

const EXISTING_SCAN_LIMIT = 1000;

/** Snapshot of the alkulify.com book archive. */
const seedBooks: BookSeed[] = [
  {
    categories: ["نقد النسوية"],
    date: "2025-02-03",
    description: "تفريغ لمحاضرات الأنثى وأحوالها بين الوحي والإنسان.",
    downloadUrl: null,
    slug: "book-18446",
    sourceUrl:
      "https://alkulify.com/book/%D8%A7%D9%84%D8%A3%D9%86%D8%AB%D9%89-%D9%88%D8%A3%D8%AD%D9%88%D8%A7%D9%84%D9%87%D8%A7-%D8%A8%D9%8A%D9%86-%D8%A7%D9%84%D9%88%D8%AD%D9%8A-%D9%88%D8%A7%D9%84%D8%A5%D9%86%D8%B3%D8%A7%D9%86/",
    title: "الأنثى وأحوالها: بين الوحي والإنسان",
  },
  {
    categories: [],
    date: "2024-08-24",
    description:
      "هذا كتاب الترجيح بين أقوال المعدلين والجارحين في أبي حنيفة النعمان بن ثابت. تصنيف: عبد الله بن فهد الخليفي",
    downloadUrl:
      "https://drive.google.com/file/d/1yrYdfLd4sib7RRzsn_AFCt0Qv_wjkKns/view",
    slug: "book-17672",
    sourceUrl:
      "https://alkulify.com/book/%D8%A7%D9%84%D8%AA%D8%B1%D8%AC%D9%8A%D8%AD-%D8%A8%D9%8A%D9%86-%D8%A3%D9%82%D9%88%D8%A7%D9%84-%D8%A7%D9%84%D9%85%D8%B9%D8%AF%D9%84%D9%8A%D9%86-%D9%88%D8%A7%D9%84%D8%AC%D8%A7%D8%B1%D8%AD%D9%8A%D9%86/",
    title: "الترجيح بين أقوال المعدلين والجارحين في أبي حنيفة النعمان بن ثابت",
  },
  {
    categories: ["الدراسات الحديثية"],
    date: "2024-08-24",
    description:
      "هذه طليعة ( المقنع في علل الحديث ) وهي ( زفرة الفرس الأخيرة ) كما يقال ، وشرطي في هذا المقنع ذكر الأحاديث المعلولة التي اشتهر بين الناس أنها صحيحة بناءً على تصحيح بعض أهل العلم المعاصرين لها ، وليعلم القاريء أنني تعرضت لأذية عظيمة بسبب شروعي في هذه الأبحاث ، وكنت قد اخترت إنزال الأبحاث التي من شرط المقنع منجمةً في الشبكات العنكبوتية عسى أن أجد تقويماً أو نصحاً أو تأييداً ، وتكاثرت الأبحاث المنشورة ولله الحمد والمنة حتى قاربت الخمسمائة والذي في هذه الطليعة هو ما لم ينشر في غالبه وهي قرابة المائة والخمسون حديثاً",
    downloadUrl:
      "https://drive.google.com/file/d/1TMpbG1xX29Dy3zsEfbYlI03QphPNNQgV/view",
    slug: "book-17673",
    sourceUrl:
      "https://alkulify.com/book/%d8%b7%d9%84%d9%8a%d8%b9%d8%a9-%d8%a7%d9%84%d9%85%d9%82%d9%86%d8%b9-%d9%81%d9%8a-%d8%b9%d9%84%d9%84-%d8%a7%d9%84%d8%ad%d8%af%d9%8a%d8%ab/",
    title: "طليعة المقنع في علل الحديث",
  },
  {
    categories: ["صحيح آثار الصحابة"],
    date: "2019-01-17",
    description: "هذا مجموع مقالات قسم الصحيح المسند من آثار صحابة رسول الله.",
    downloadUrl: null,
    slug: "book-17790",
    sourceUrl:
      "https://alkulify.com/book/%D8%A7%D9%84%D8%B5%D8%AD%D9%8A%D8%AD-%D8%A7%D9%84%D9%85%D8%B3%D9%86%D8%AF-%D9%85%D9%86-%D8%A2%D8%AB%D8%A7%D8%B1-%D8%A7%D9%84%D8%B5%D8%AD%D8%A7%D8%A8%D8%A9/",
    title: "الصحيح المسند من آثار الصحابة",
  },
  {
    categories: ["التوحيد والعقيدة", "الردود والتعقيبات"],
    date: "2015-05-03",
    description:
      "هذا كتاب يبين ما ننتهجه في العقيدة والفقه والتفسير والحديث والجرح والتعديل مما نخالف فيه جماعة المعاصرين أو أغلبهم أو عددًا من مشاهيرهم.",
    downloadUrl:
      "https://drive.google.com/file/d/1CTnFYwG3fw2_vIrmRdff1SaYnp5x4shq/view",
    slug: "book-17674",
    sourceUrl:
      "https://alkulify.com/book/%D8%AA%D9%82%D9%88%D9%8A%D9%85-%D8%A7%D9%84%D9%85%D8%B9%D8%A7%D8%B5%D8%B1%D9%8A%D9%86/",
    title: "تقويم المعاصرين",
  },
  {
    categories: ["الدراسات الحديثية", "كتب"],
    date: "2013-11-01",
    description:
      "فهذا بحث في مسألة ما كان ينبغي أن تكون محل نزاع بين طلبة العلم لوضوحها، وهي مسألة كون بدعة الأشاعرة مكفرة. وإثبات الإجماع فيها من عدة طرق.",
    downloadUrl:
      "https://drive.google.com/file/d/1NbxYM-usUuONUozNC0DZ48dnljSpcvsy/view",
    slug: "post-6744",
    sourceUrl:
      "https://alkulify.com/book/%d8%a7%d9%84%d9%88%d8%ac%d9%88%d9%87-%d9%81%d9%8a-%d8%a5%d8%ab%d8%a8%d8%a7%d8%aa-%d8%a7%d9%84%d8%a5%d8%ac%d9%85%d8%a7%d8%b9-%d8%b9%d9%84%d9%89-%d8%a3%d9%86-%d8%a8%d8%af%d8%b9%d8%a9-%d8%a7%d9%84%d8%a3/",
    title: "الوجوه في إثبات الإجماع على أن بدعة الأشاعرة مكفرة",
  },
  {
    categories: ["الدراسات الحديثية"],
    date: "2008-08-29",
    description:
      "فقد قال تعالى (( ولتكن منكم أمةٌ يدعون إلى الخير ويأمرون بالمعروف وينهون عن المنكر )) ومن أعظم المنكرات البدع في الدين قال رسول الله صلى الله عليه وسلم (( وشر الأمور محدثاتها )) رواه البخاري وأعظم البدع بدع الإعتقاد إجماعاً فعامتها مفضية إلى الكفر والعياذ بالله، فانطلاقاً من هذه القواعد الراسخة المأخوذة من هذه النصوص العظيمة وغيرها كان لزاماً على أهل السنة أن يردوا على أهل البدع ويكشفوا عوارهم لئلا يغتر بهم أحد وقد روي عن النبي صلى الله عليه وسلم (( من رَدَّ عن عرضِ أخيهِ ردَّ اللهُ عن وجهِهِ النَّارَ يومَ القيامةِ )) رواه الترمذي (١٩٩٦) وحسنه وله شواهد ليس هذا مقام بسطها",
    downloadUrl:
      "https://drive.google.com/file/d/1xSW7xb89T_GOQqXk3WaJ1Wf1_a2LNtu6/view",
    slug: "book-17688",
    sourceUrl:
      "https://alkulify.com/book/%D8%A7%D9%84%D8%AF%D9%81%D8%A7%D8%B9-%D8%B9%D9%86-%D8%AD%D8%AF%D9%8A%D8%AB-%D8%A7%D9%84%D8%AC%D8%A7%D8%B1%D9%8A%D8%A9/",
    title: "الدفاع عن حديث الجارية",
  },
  {
    categories: ["الردود والتعقيبات"],
    date: "2007-04-28",
    description:
      "رسالة في نقد كتاب الإغاثة بأدلة الاستغاثة، نقحها المؤلف ورتبها للنشر.",
    downloadUrl:
      "https://drive.google.com/file/d/1WeH5Km-JTfDLV-wXEHpppCeT_XrSg8Zq/view",
    slug: "book-17690",
    sourceUrl:
      "https://alkulify.com/book/%D8%A7%D9%84%D8%A5%D8%B3%D8%B9%D8%A7%D9%81-%D9%85%D9%86-%D8%A5%D8%BA%D8%A7%D8%AB%D8%A9-%D8%A7%D9%84%D8%B3%D9%82%D8%A7%D9%81/",
    title: "الإسعاف من إغاثة السقاف",
  },
  {
    categories: ["التوحيد والعقيدة"],
    date: null,
    description: "بحث في نسبة التفويض إلى السلف ومناقشة هذه النسبة.",
    downloadUrl:
      "https://drive.google.com/file/d/1UaX1NpIUDMolVQCf_Kjli0J2PEdwwS2I/view",
    slug: "book-baraat-salaf",
    sourceUrl:
      "https://drive.google.com/drive/folders/1_PWOwSJ3ptMTMM_Cn2yuu4jQSLQ406B2",
    title: "براءة السلف من عقيدة التفويض",
  },
  {
    categories: ["الدراسات الحديثية"],
    date: null,
    description: "جمع لمن زكاه الصحابة من التابعين، دون ادعاء الاستقصاء.",
    downloadUrl:
      "https://drive.google.com/file/d/1b-o7ihoRwacx9ltwt3r2rK-3cq0WTR6H/view",
    slug: "book-man-zakkahu",
    sourceUrl:
      "https://drive.google.com/drive/folders/1_PWOwSJ3ptMTMM_Cn2yuu4jQSLQ406B2",
    title: "من زكاه الصحابة من التابعين",
  },
  {
    categories: ["صحيح آثار الصحابة"],
    date: null,
    description: "جمع لآثار العشرة المبشرين بالجنة في الزهد والرقائق والأدب.",
    downloadUrl:
      "https://drive.google.com/file/d/1grKPI6vZ4lby8rWMoGE4SyyAcLDyR74H/view",
    slug: "book-sahih-ashara",
    sourceUrl:
      "https://drive.google.com/drive/folders/1_PWOwSJ3ptMTMM_Cn2yuu4jQSLQ406B2",
    title: "الصحيح المسند من آثار العشرة المبشرين بالجنة رضي الله عنهم",
  },
  {
    categories: ["التوحيد والعقيدة", "الردود والتعقيبات"],
    date: null,
    description: "رد على كتاب دفع شبه التشبيه بأكف التنزيه وتحقيق حسن السقاف.",
    downloadUrl:
      "https://drive.google.com/file/d/1PwsRsGMMS3asuzs46AzidH2jSR-69x0Z/view",
    slug: "book-tasfih-adiaa",
    sourceUrl:
      "https://drive.google.com/drive/folders/1_PWOwSJ3ptMTMM_Cn2yuu4jQSLQ406B2",
    title: "تسفيه أدعياء التنزيه",
  },
  {
    categories: ["الردود والتعقيبات"],
    date: null,
    description:
      "الجزء الأول من كتاب في الذب عن العلامة الألباني، ويتناول نقد الجزء الأول من كتاب تناقضات الألباني الواضحات.",
    downloadUrl:
      "https://drive.google.com/file/d/1Uu_-gJm3cv3q60YDXCfdvVnZsa4TTegC/view",
    slug: "book-tawfiq-rabbani",
    sourceUrl:
      "https://drive.google.com/drive/folders/1_PWOwSJ3ptMTMM_Cn2yuu4jQSLQ406B2",
    title: "التوفيق الرباني في الذب عن العلامة الألباني",
  },
];

/**
 * Upserts the bundled book snapshot. Books are matched by `slug` and an
 * existing slug is left untouched, so this is safe to re-run.
 *
 * Run with `npx convex run seed:seed`.
 */
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("books").take(EXISTING_SCAN_LIMIT);
    const existingSlugs = new Set(existing.map((book) => book.slug));

    const toInsert = seedBooks
      .map((book, index) => ({ ...book, order: index, published: true }))
      .filter((book) => !existingSlugs.has(book.slug));

    await Promise.all(toInsert.map((book) => ctx.db.insert("books", book)));

    return {
      inserted: toInsert.length,
      skipped: seedBooks.length - toInsert.length,
    };
  },
  returns: v.object({ inserted: v.number(), skipped: v.number() }),
});
