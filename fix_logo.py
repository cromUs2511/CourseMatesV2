
with open('src/components/AccessGateway.tsx', 'r') as f:
    content = f.read()

old_logo = """        {/* Main Titles */}
        <div className="flex flex-col items-center justify-center space-y-1 z-10">
          <h1 className="text-7xl md:text-[8rem] font-bold font-serif tracking-tight text-[#dc2626] leading-none" style={{ textShadow: isDarkMode ? '4px 4px 0 rgba(0,0,0,0.8)' : '2px 2px 0 rgba(0,0,0,0.1)' }}>
            &lt;Course&gt;
          </h1>
          <h1 className="text-7xl md:text-[8rem] font-bold font-sans tracking-tighter text-[#d97706] leading-none" style={{ textShadow: isDarkMode ? '4px 4px 0 rgba(0,0,0,0.8)' : '2px 2px 0 rgba(0,0,0,0.1)' }}>
            &lt;Mates&gt;
          </h1>
        </div>"""

new_logo = """        {/* Main Titles Logo Lockup */}
        <div className="flex flex-col items-center justify-center z-10 relative">
          <div className="relative group cursor-default selection:bg-transparent">
            {/* Ambient aesthetic glow */}
            <div className={`absolute -inset-x-12 -inset-y-8 bg-gradient-to-r from-[#991B1B]/10 to-[#d97706]/10 blur-3xl rounded-[100px] opacity-0 group-hover:opacity-100 transition duration-1000 pointer-events-none`}></div>
            
            <div className="relative flex flex-col items-start -space-y-4 md:-space-y-6 drop-shadow-sm hover:scale-[1.01] transition-transform duration-500">
              {/* <Course> */}
              <div className="flex items-baseline">
                <span className={`text-5xl md:text-7xl font-light font-mono mr-2 opacity-50 ${isDarkMode ? 'text-stone-500' : 'text-stone-400'}`}>&lt;</span>
                <h1 className="text-[5.5rem] md:text-[8.5rem] font-black font-serif tracking-tight text-[#991B1B] leading-none">
                  Course
                </h1>
                <span className={`text-5xl md:text-7xl font-light font-mono ml-2 opacity-50 ${isDarkMode ? 'text-stone-500' : 'text-stone-400'}`}>&gt;</span>
              </div>
              
              {/* <Mates> */}
              <div className="flex items-baseline ml-12 md:ml-32">
                <span className={`text-5xl md:text-7xl font-light font-mono mr-2 opacity-50 ${isDarkMode ? 'text-stone-500' : 'text-stone-400'}`}>&lt;</span>
                <h1 className="text-[5.5rem] md:text-[8.5rem] font-bold font-sans tracking-tighter text-[#d97706] leading-none">
                  Mates
                </h1>
                <span className={`text-5xl md:text-7xl font-light font-mono ml-2 opacity-50 ${isDarkMode ? 'text-stone-500' : 'text-stone-400'}`}>&gt;</span>
              </div>
            </div>
          </div>
          
          <div className="mt-12 md:mt-16 flex items-center space-x-4 md:space-x-6 opacity-80">
            <div className={`h-px w-12 md:w-16 ${isDarkMode ? 'bg-stone-700' : 'bg-stone-300'}`}></div>
            <span className={`font-mono text-[9px] md:text-[10px] uppercase tracking-[0.3em] md:tracking-[0.4em] ${isDarkMode ? 'text-stone-500' : 'text-stone-400'}`}>
              Anonymous Student Network
            </span>
            <div className={`h-px w-12 md:w-16 ${isDarkMode ? 'bg-stone-700' : 'bg-stone-300'}`}></div>
          </div>
        </div>"""

if old_logo in content:
    content = content.replace(old_logo, new_logo)
    with open('src/components/AccessGateway.tsx', 'w') as f:
        f.write(content)
    print("Logo updated.")
else:
    print("Old logo text not found! Checking alternative match...")
