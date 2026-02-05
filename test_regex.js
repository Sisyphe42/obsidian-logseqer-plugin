
const configContent = ':favorites ["page1" "page2" "page3"]';
const favoritesRegex = /:favorites\s*\[([^\]]*)\]/;
const match = configContent.match(favoritesRegex);

if (!match) {
    console.log("No match");
} else {
    const favoritesStr = match[1];
    console.log("Captured string:", favoritesStr);

    const pages = favoritesStr.match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, '')) || [];
    console.log("Pages found:", pages);
}
