#![no_std]
#![allow(non_snake_case)]

#[panic_handler]
fn on_panic(_info: &::core::panic::PanicInfo) -> ! {
    loop {}
}

#[no_mangle]
pub unsafe fn draw() {}
