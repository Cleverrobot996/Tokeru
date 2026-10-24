//! 读取 Windows 已安装的字体族，供「试卷排版」选择字体。
//! 不走第三方依赖，直接调用 GDI 的 EnumFontFamiliesExW。

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;

    const LF_FACESIZE: usize = 32;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct LogFontW {
        height: i32,
        width: i32,
        escapement: i32,
        orientation: i32,
        weight: i32,
        italic: u8,
        underline: u8,
        strike_out: u8,
        char_set: u8,
        out_precision: u8,
        clip_precision: u8,
        quality: u8,
        pitch_and_family: u8,
        face_name: [u16; LF_FACESIZE],
    }

    impl LogFontW {
        fn empty() -> Self {
            Self {
                height: 0,
                width: 0,
                escapement: 0,
                orientation: 0,
                weight: 0,
                italic: 0,
                underline: 0,
                strike_out: 0,
                char_set: 1, // DEFAULT_CHARSET
                out_precision: 0,
                clip_precision: 0,
                quality: 0,
                pitch_and_family: 0,
                face_name: [0; LF_FACESIZE],
            }
        }
    }

    #[repr(C)]
    struct EnumLogFontExW {
        elf_log_font: LogFontW,
        elf_full_name: [u16; 64],
        elf_style: [u16; 32],
        elf_script: [u16; 32],
    }

    type FontEnumProcW = Option<
        unsafe extern "system" fn(*const EnumLogFontExW, *const c_void, u32, isize) -> i32,
    >;

    #[link(name = "gdi32")]
    extern "system" {
        fn EnumFontFamiliesExW(
            hdc: isize,
            lp_log_font: *const LogFontW,
            lp_proc: FontEnumProcW,
            l_param: isize,
            flags: u32,
        ) -> i32;
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetDC(hwnd: isize) -> isize;
        fn ReleaseDC(hwnd: isize, hdc: isize) -> i32;
    }

    unsafe extern "system" fn collect(
        log_font: *const EnumLogFontExW,
        _metric: *const c_void,
        _font_type: u32,
        l_param: isize,
    ) -> i32 {
        let out = &mut *(l_param as *mut Vec<String>);
        let raw = &(*log_font).elf_log_font.face_name;
        let len = raw.iter().position(|c| *c == 0).unwrap_or(raw.len());
        if len > 0 {
            let name = String::from_utf16_lossy(&raw[..len]);
            // 以 @ 开头的是竖排字体，不适合正文；空名跳过。
            if !name.is_empty() && !name.starts_with('@') && !out.iter().any(|n| n == &name) {
                out.push(name);
            }
        }
        1
    }

    pub fn list() -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        unsafe {
            let hdc = GetDC(0);
            if hdc == 0 {
                return out;
            }
            let lf = LogFontW::empty();
            EnumFontFamiliesExW(hdc, &lf, Some(collect), &mut out as *mut _ as isize, 0);
            ReleaseDC(0, hdc);
        }
        out.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
        out.dedup();
        out
    }
}

#[cfg(windows)]
pub fn list_system_fonts() -> Vec<String> {
    imp::list()
}

#[cfg(not(windows))]
pub fn list_system_fonts() -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    #[test]
    fn enumerates_windows_fonts() {
        let fonts = super::list_system_fonts();
        println!("font families: {}", fonts.len());
        for name in fonts.iter().take(8) {
            println!("- {name}");
        }
        #[cfg(windows)]
        assert!(fonts.len() > 10, "Windows 系统字体数量异常：{}", fonts.len());
    }
}
