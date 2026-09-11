
with open('src/components/AccessGateway.tsx', 'r') as f:
    content = f.read()

# Typography for main titles - blend serif and sans-serif for aesthetic contrast
course_old = """<h1 className="text-7xl md:text-[8rem] font-bold font-mono tracking-tighter text-[#dc2626]" style={{ textShadow: isDarkMode ? '4px 4px 0 rgba(0,0,0,0.8)' : '3px 3px 0 rgba(0,0,0,0.1)' }}>"""
course_new = """<h1 className="text-7xl md:text-[8rem] font-bold font-serif tracking-tight text-[#dc2626] leading-none" style={{ textShadow: isDarkMode ? '4px 4px 0 rgba(0,0,0,0.8)' : '2px 2px 0 rgba(0,0,0,0.1)' }}>"""

mates_old = """<h1 className="text-7xl md:text-[8rem] font-bold font-mono tracking-tighter text-[#d97706]" style={{ textShadow: isDarkMode ? '4px 4px 0 rgba(0,0,0,0.8)' : '3px 3px 0 rgba(0,0,0,0.1)' }}>"""
mates_new = """<h1 className="text-7xl md:text-[8rem] font-bold font-sans tracking-tighter text-[#d97706] leading-none" style={{ textShadow: isDarkMode ? '4px 4px 0 rgba(0,0,0,0.8)' : '2px 2px 0 rgba(0,0,0,0.1)' }}>"""

content = content.replace(course_old, course_new)
content = content.replace(mates_old, mates_new)

# Tighten spacing in title container
content = content.replace('<div className="flex flex-col items-center justify-center space-y-4 z-10">', '<div className="flex flex-col items-center justify-center space-y-1 z-10">')

# Refine the secondary campus button to look distinctly inactive/gray compared to the primary campus
# The primary campus is red; the secondary campus inactive state should be clean.
makati_inactive = "border-stone-300 bg-stone-50 text-stone-600 hover:border-stone-400"
makati_inactive_new = "border-stone-300 bg-[#FAF8F5] text-stone-500 hover:bg-stone-100 hover:text-stone-700"

content = content.replace(
    "border-stone-300 bg-stone-50 text-stone-600 hover:border-stone-400",
    "border-stone-300 bg-transparent text-stone-500 hover:bg-stone-200/50 hover:text-stone-700"
)

with open('src/components/AccessGateway.tsx', 'w') as f:
    f.write(content)
