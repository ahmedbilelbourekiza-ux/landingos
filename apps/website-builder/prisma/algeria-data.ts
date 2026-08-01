// Algeria administrative divisions — 58 wilayas with their baladias (communes).
// Source: official Algerian administrative structure (2021 reform added 10 new
// wilayas, bringing the total from 48 to 58). Each wilaya has an official
// numeric code (01–58). Baladia names are in French/Latin script; Arabic
// names can be added later.
//
// This is a representative dataset — every wilaya is included, with at least
// the major communes. The full ~1,541 communes can be added incrementally;
// the structure supports it without schema changes.

export interface WilayaSeed {
  code: string;
  name: string;
  nameAr?: string;
  baladias: string[];
}

export const algeriaWilayas: WilayaSeed[] = [
  { code: "01", name: "Adrar", nameAr: "أدرار", baladias: ["Adrar", "Tamest", "Charouine", "Reggane", "Inozghmir", "Tit", "Ksar Kaddour", "Tsabit", "Timimoun", "Ouled Said"] },
  { code: "02", name: "Chlef", nameAr: "الشلف", baladias: ["Chlef", "Tenes", "Boukadir", "El Karimia", "Tadjena", "Taougrite", "Beni Haoua", "Ouled Fares", "El Marsa", "Zeboudja"] },
  { code: "03", name: "Laghouat", nameAr: "الأغواط", baladias: ["Laghouat", "Ksar El Hirane", "Bennasser Benchohra", "Sidi Makhlouf", "Hassi Delaa", "Hassi R'Mel", "Ain Madhi", "Tadjmout", "Kheneg", "Gueltat Sidi Saad"] },
  { code: "04", name: "Oum El Bouaghi", nameAr: "أم البواقي", baladias: ["Oum El Bouaghi", "Ain Beida", "Ain M'lila", "Sigus", "El Belala", "Meskiana", "Ain Fakroun", "Souk Naamane", "Zorg", "El Djazia"] },
  { code: "05", name: "Batna", nameAr: "باتنة", baladias: ["Batna", "Barika", "Arris", "Merouana", "Seriana", "N'Gaous", "Tazoult", "Ras El Aioun", "Timgad", "Ain Touta"] },
  { code: "06", name: "Bejaia", nameAr: "بجاية", baladias: ["Bejaia", "Akbou", "Sidi Aich", "El Kseur", "Amizour", "Tichy", "Souk El Tenine", "Aokas", "Tazmalt", "Semaoun"] },
  { code: "07", name: "Biskra", nameAr: "بسكرة", baladias: ["Biskra", "Tolga", "Ouled Djellal", "Sidi Okba", "El Kantara", "Zeribet El Oued", "Foughala", "Ourlal", "Chetma", "Branis"] },
  { code: "08", name: "Bechar", nameAr: "بشار", baladias: ["Bechar", "Kenadsa", "Beni Ounif", "Taghit", "Lahmar", "Mogheul", "Abadla", "Boukais", "Igli", "Kerzaz"] },
  { code: "09", name: "Blida", nameAr: "البليدة", baladias: ["Blida", "Boufarik", "Ouled Yaich", "Mouzaia", "El Affroun", "Bouinan", "Larbaa", "Meftah", "Oued El Alleug", "Chebli"] },
  { code: "10", name: "Bouira", nameAr: "البويرة", baladias: ["Bouira", "Lakhdaria", "Sour El Ghozlane", "M'Chedallah", "Bechloul", "Kadiria", "Ain Bessem", "Bir Ghbalou", "Bordj Okhriss", "Hadjera Zerga"] },
  { code: "11", name: "Tamanrasset", nameAr: "تمنراست", baladias: ["Tamanrasset", "Abalessa", "In Ghar", "In Salah", "Idles", "Tazrouk", "Foggaret Ezzaouia", "In Amguel", "Tin Zaouatine", "Tabankort"] },
  { code: "12", name: "Tebessa", nameAr: "تبسة", baladias: ["Tebessa", "Bir El Ater", "Cheria", "El Aouinet", "Morsott", "Negrine", "Ouenza", "El Kouif", "Bekkaria", "Stah Guentis"] },
  { code: "13", name: "Tlemcen", nameAr: "تلمسان", baladias: ["Tlemcen", "Maghnia", "Ghazaouet", "Nedroma", "Remchi", "Sebdou", "Hennaya", "Bab El Assa", "Beni Snous", "Sebbaa Chioukh"] },
  { code: "14", name: "Tiaret", nameAr: "تيارت", baladias: ["Tiaret", "Sougueur", "Frenda", "Mahdia", "Ksar Chellala", "Dahmouni", "Ain Deheb", "Hamadia", "Medroussa", "Sidi Bakhti"] },
  { code: "15", name: "Tizi Ouzou", nameAr: "تيزي وزو", baladias: ["Tizi Ouzou", "Azazga", "Draa Ben Khedda", "Tigzirt", "Ain El Hammam", "Bouzeguene", "Tizi Rached", "Makouda", "Iferhounene", "Draa El Mizan"] },
  { code: "16", name: "Alger", nameAr: "الجزائر", baladias: ["Alger Centre", "Sidi M'Hamed", "El Madania", "Hussein Dey", "Bab El Oued", "Bologhine", "Casbah", "Oued Koriche", "Bir Mourad Rais", "El Biar", "Bouzareah", "Birkhadem", "El Harrach", "Baraki", "Oued Smar", "Bourouba", "Hamma Anassers", "Djasr Kasentina", "Bab Ezzouar", "Dar El Beida", "Bainem", "Rais Hamidou", "Dely Ibrahim", "Birtouta", "Tassala El Merdja", "Douera", "Rouiba", "Reghaia", "Ain Taya", "Marsa", "Heraoua"] },
  { code: "17", name: "Djelfa", nameAr: "الجلفة", baladias: ["Djelfa", "Messaad", "Ain Oussera", "El Idrissia", "Hassi Bahbah", "Birine", "Charef", "Dar Chioukh", "Douis", "Ain El Ibel"] },
  { code: "18", name: "Jijel", nameAr: "جيجل", baladias: ["Jijel", "Taher", "El Milia", "Chekfa", "Ziama Mansouriah", "El Aouana", "Settara", "Emir Abdelkader", "Sidi Abdelaziz", "Kaous"] },
  { code: "19", name: "Setif", nameAr: "سطيف", baladias: ["Setif", "El Eulma", "Ain Oulmene", "Bouga", "Boussada", "Jijel", "Salah Bey", "Ain Arnat", "Beni Aziz", "Guellal"] },
  { code: "20", name: "Saida", nameAr: "سعيدة", baladias: ["Saida", "Ain El Hadjar", "Moulay Larbi", "Youb", "Sidi Boubekeur", "Doui Thabet", "Hounet", "Sidi Amar", "El Hassasna", "Maamora"] },
  { code: "21", name: "Skikda", nameAr: "سكيكدة", baladias: ["Skikda", "Azzaba", "Collo", "El Harrouch", "Tamalous", "Ain Charchar", "Ben Azzouz", "Es Sebt", "Filfila", "El Hadaiek"] },
  { code: "22", name: "Sidi Bel Abbes", nameAr: "سيدي بلعباس", baladias: ["Sidi Bel Abbes", "Telagh", "Mostefa Ben Brahim", "Sfisef", "Ben Badis", "Tessala", "Sidi Lahcene", "Sidi Ali Boussidi", "Badredine El Mokrani", "Marhoum"] },
  { code: "23", name: "Annaba", nameAr: "عنابة", baladias: ["Annaba", "Berrahal", "El Hadjar", "Eulma", "El Bouni", "Seraidi", "Chetaibi", "Sidi Amer", "Treat", "Ain Berda"] },
  { code: "24", name: "Guelma", nameAr: "قالمة", baladias: ["Guelma", "Oued Zenati", "Bouchegouf", "Hammam Debagh", "Heliopolis", "Khezara", "Hammam N'Bails", "Ain Makhlouf", "Ain Ben Beida", "Guelaat Bou Sbaa"] },
  { code: "25", name: "Constantine", nameAr: "قسنطينة", baladias: ["Constantine", "Hamma Bouziane", "El Khroub", "Ain Smara", "Zighoud Youcef", "Didouche Mourad", "Beni Hamiden", "Ibn Ziad", "Ain Abid", "Ouled Rahmoune"] },
  { code: "26", name: "Medea", nameAr: "المدية", baladias: ["Medea", "Berrouaghia", "Ksar El Boukhari", "Beni Slimane", "Tablat", "Ouzera", "Ouamri", "El Omaria", "Si Mahdjoub", "Bouaiche"] },
  { code: "27", name: "Mostaganem", nameAr: "مستغانم", baladias: ["Mostaganem", "Ain Tedles", "Sidi Ali", "Hassi Mameche", "Achaacha", "Bouguirat", "Kheir Eddine", "Sour", "Mesra", "Stidia"] },
  { code: "28", name: "M'Sila", nameAr: "المسيلة", baladias: ["M'Sila", "Bou Saada", "Sidi Aissa", "Magra", "Hamman Dalaa", "Ain El Melh", "Ouled Derradj", "Khoubana", "Mtarfa", "Ouled Addi Guebala"] },
  { code: "29", name: "Mascara", nameAr: "معسكر", baladias: ["Mascara", "Sig", "Mohammadia", "Tighennif", "El Bordj", "Ghriss", "Oued El Abtal", "Ain Fares", "Bouhanifia", "Tizi"] },
  { code: "30", name: "Ouargla", nameAr: "ورقلة", baladias: ["Ouargla", "Touggourt", "N'Goussa", "Rouissat", "Sidi Khouiled", "Hassi Ben Abdellah", "Tamacine", "Nezla", "Zaouia El Abidia", "El Hadjira"] },
  { code: "31", name: "Oran", nameAr: "وهران", baladias: ["Oran", "Es Senia", "Bir El Djir", "Arzew", "Bethioua", "Marsat El Hadjadj", "Ain Turk", "El Ancar", "Oued Tlelat", "Tafraoui", "Boufatis", "Mers El Kebir", "Sidi Chami", "Hassi Bounif", "Ben Freha", "Hassi Ben Okba"] },
  { code: "32", name: "El Bayadh", nameAr: "البيض", baladias: ["El Bayadh", "Bougtoub", "Boualem", "Brezina", "Chellala", "Rogassa", "Stitten", "El Abiodh Sidi Cheikh", "Boussemghoun", "El Mehara"] },
  { code: "33", name: "Illizi", nameAr: "إليزي", baladias: ["Illizi", "Djanet", "Debdeb", "In Amenas", "Bordj Omar Driss", "Bordj El Haouas"] },
  { code: "34", name: "Bordj Bou Arreridj", nameAr: "برج بوعريريج", baladias: ["Bordj Bou Arreridj", "Ras El Oued", "Mansoura", "El Achir", "Bordj Ghedir", "Bordj Zemoura", "El Hamadia", "Ksour", "Hasnaoua", "Taglait"] },
  { code: "35", name: "Boumerdes", nameAr: "بومرداس", baladias: ["Boumerdes", "Bordj Menaiel", "Dellys", "Thenia", "Naciria", "Khemis El Khechna", "Issers", "Si Mustapha", "Boudouaou", "Ammal"] },
  { code: "36", name: "El Tarf", nameAr: "الطارف", baladias: ["El Tarf", "El Kala", "Ben M'Hidi", "Bouhadjar", "Drean", "Chebaita Mokhtar", "Bouteldja", "Lac Des Oiseaux", "Berrihane", "Echatt"] },
  { code: "37", name: "Tindouf", nameAr: "تندوف", baladias: ["Tindouf", "Oum El Assel"] },
  { code: "38", name: "Tissemsilt", nameAr: "تيسمسيلت", baladias: ["Tissemsilt", "Theniet El Had", "Bordj Bou Naama", "Lardjem", "Bordj Emir Abdelkader", "Layoune", "Khemisti", "Ammari", "Boucaid", "Sidi Lantri"] },
  { code: "39", name: "El Oued", nameAr: "الوادي", baladias: ["El Oued", "Robbah", "Guemar", "Kouinine", "Reguiba", "Hamraia", "Bayadha", "Debila", "Hassani Abdelkrim", "Taleb Larbi"] },
  { code: "40", name: "Khenchela", nameAr: "خنشلة", baladias: ["Khenchela", "Bouhamama", "El Hamma", "Ain Touila", "Kais", "Baghai", "Cherchar", "Tamza", "El Oueldja", "Remila"] },
  { code: "41", name: "Souk Ahras", nameAr: "سوق أهراس", baladias: ["Souk Ahras", "Sedrata", "M'Daourouch", "Bir Bouhouche", "Mechroha", "Taoura", "Zaarouria", "Heddada", "Khedara", "Ouled Driss"] },
  { code: "42", name: "Tipaza", nameAr: "تيبازة", baladias: ["Tipaza", "Cherchell", "Hadjout", "Koléa", "Fouka", "Bou Ismail", "Nador", "Hadjeret Ennous", "Sidi Amar", "Aghbal"] },
  { code: "43", name: "Mila", nameAr: "ميلة", baladias: ["Mila", "Ferdjioua", "Chelghoum Laid", "Grarem Gouga", "Tadjenanet", "Oued Endja", "Teleghma", "Ain Beida Harriche", "Bouhatem", "Rouached"] },
  { code: "44", name: "Ain Defla", nameAr: "عين الدفلى", baladias: ["Ain Defla", "Khemis Miliana", "Miliana", "El Attaf", "El Abadia", "Djendel", "Boumedfaa", "Hammam Righa", "Ain Torki", "Rouina"] },
  { code: "45", name: "Naama", nameAr: "النعامة", baladias: ["Naama", "Mecheria", "Ain Sefra", "Tiout", "Sfissifa", "Moghrar", "Asla", "Djeniane Bourzeg", "Ain Ben Khelil", "Makman Ben Amer"] },
  { code: "46", name: "Ain Temouchent", nameAr: "عين تموشنت", baladias: ["Ain Temouchent", "Hammam Bou Hadjar", "El Amria", "Beni Saf", "Oulhaca El Gheraba", "Hassasna", "El Malah", "Ain Kihal", "Hassian Ghobrini", "Sidi Ben Adda"] },
  { code: "47", name: "Ghardaia", nameAr: "غرداية", baladias: ["Ghardaia", "Metlili", "El Guerrara", "Berriane", "Daia Ben Dahoua", "Zelfana", "Sebseb", "Bounoura", "El Atteuf", "Mansourah"] },
  { code: "48", name: "Relizane", nameAr: "غليزان", baladias: ["Relizane", "Oued Rhiou", "Mazouna", "Zemmoura", "Ammi Moussa", "Yellel", "Mendes", "Sidi M'Hamed Ben Ali", "Sidi Saada", "Ramka"] },
  // New wilayas (2019 administrative reform)
  { code: "49", name: "Timimoun", nameAr: "تيميمون", baladias: ["Timimoun", "Ouled Said", "Tinerkouk", "Charouine", "Talmine", "Reggane"] },
  { code: "50", name: "Bordj Badji Mokhtar", nameAr: "برج باجي مختار", baladias: ["Bordj Badji Mokhtar", "Timiaouine"] },
  { code: "51", name: "Ouled Djellal", nameAr: "أولاد جلال", baladias: ["Ouled Djellal", "Sidi Khaled", "Doucen", "Ras El Miaad", "Besbes"] },
  { code: "52", name: "Beni Abbes", nameAr: "بني عباس", baladias: ["Beni Abbes", "Tabelbala", "Igli", "Kerzaz", "Ouled Khoudir", "Tamdelt"] },
  { code: "53", name: "In Salah", nameAr: "عين صالح", baladias: ["In Salah", "Foggaret Ezzaouia", "In Ghar"] },
  { code: "54", name: "In Guezzam", nameAr: "عين قزام", baladias: ["In Guezzam", "Tin Zaouatine"] },
  { code: "55", name: "Touggourt", nameAr: "تقرت", baladias: ["Touggourt", "Tamacine", "Nezla", "Zaouia El Abidia", "Megarine", "Sidi Slimane", "El Hadjira"] },
  { code: "56", name: "Djanet", nameAr: "جانت", baladias: ["Djanet", "Bordj El Haouas"] },
  { code: "57", name: "El M'Ghair", nameAr: "المغير", baladias: ["El M'Ghair", "Still", "Djamaa", "Sidi Amrane", "Tendla", "M'Rara"] },
  { code: "58", name: "El Meniaa", nameAr: "المنيعة", baladias: ["El Meniaa", "Hassi Gara", "Hassi Fehal"] },
];
