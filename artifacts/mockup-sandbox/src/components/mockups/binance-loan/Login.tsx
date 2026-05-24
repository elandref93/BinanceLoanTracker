import React from "react";
import "./_group.css";

export function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="ledger-theme w-[390px] h-[844px] relative bg-app overflow-hidden flex flex-col border border-[#111] rounded-[40px] shadow-2xl">
        {/* Status Bar */}
        <div className="flex justify-between items-center px-6 pt-4 pb-2 text-[13px] font-medium text-white z-10">
          <div className="tabular">9:41</div>
          <div className="flex gap-1.5 items-center">
            <div className="w-4 h-3 bg-white rounded-[2px]" />
            <div className="w-3 h-3 bg-white rounded-full" />
            <div className="w-5 h-2.5 border border-white rounded-sm relative">
              <div className="absolute top-[1px] left-[1px] bottom-[1px] w-[70%] bg-white rounded-[1px]" />
              <div className="absolute right-[-3px] top-1/2 -translate-y-1/2 w-[2px] h-1 bg-white rounded-r-sm" />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col items-center justify-center px-8 relative z-10 mt-[-60px]">
          <h1 className="text-4xl font-semibold tracking-tighter text-primary mb-3">Ledger</h1>
          <p className="text-muted text-[15px] mb-16 text-center tracking-wide">Loan health, at a glance.</p>
          
          <button className="w-full h-12 bg-white text-black rounded-lg font-medium text-[15px] flex items-center justify-center gap-3 hover:bg-gray-100 transition-colors">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.64 9.20455C17.64 8.56636 17.5827 7.95273 17.4764 7.36364H9V10.845H13.8436C13.635 11.97 13.0009 12.9232 12.0477 13.5614V15.8195H14.9564C16.6582 14.2527 17.64 11.9455 17.64 9.20455Z" fill="#4285F4"/>
              <path d="M9 18C11.43 18 13.4673 17.1941 14.9564 15.8195L12.0477 13.5614C11.2418 14.1014 10.2109 14.4205 9 14.4205C6.65591 14.4205 4.67182 12.8373 3.96409 10.71H0.957275V13.0418C2.43818 15.9832 5.48182 18 9 18Z" fill="#34A853"/>
              <path d="M3.96409 10.71C3.78409 10.17 3.68182 9.59318 3.68182 9C3.68182 8.40682 3.78409 7.83 3.96409 7.29V4.95818H0.957275C0.347727 6.17318 0 7.54773 0 9C0 10.4523 0.347727 11.8268 0.957275 13.0418L3.96409 10.71Z" fill="#FBBC05"/>
              <path d="M9 3.57955C10.3214 3.57955 11.5077 4.03364 12.4405 4.92545L15.0218 2.34409C13.4632 0.891818 11.4259 0 9 0C5.48182 0 2.43818 2.01682 0.957275 4.95818L3.96409 7.29C4.67182 5.16273 6.65591 3.57955 9 3.57955Z" fill="#EA4335"/>
            </svg>
            Sign in with Google
          </button>
        </div>

        {/* Footer */}
        <div className="absolute bottom-10 left-0 right-0 flex justify-center z-10">
          <p className="text-[#444] text-[11px] font-mono tracking-widest uppercase">PRIVATE BUILD v1.0.4</p>
        </div>

        {/* Home Indicator */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-1/3 h-[5px] bg-white rounded-full opacity-20 z-10" />
      </div>
    </div>
  );
}
