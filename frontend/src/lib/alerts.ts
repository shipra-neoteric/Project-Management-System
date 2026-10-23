/**
 * SweetAlert2 wrappers (Nexora rule: never window.confirm/alert).
 * Loaded lazily so the library never runs during server rendering.
 */
async function swal() {
  return (await import('sweetalert2')).default;
}

export async function confirmDanger(title: string, text = 'This action cannot be undone.', confirmButtonText = 'Delete') {
  const Swal = await swal();
  const result = await Swal.fire({
    icon: 'warning',
    title,
    text,
    showCancelButton: true,
    confirmButtonText,
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#ef4444',
    reverseButtons: true,
    focusCancel: true,
  });
  return result.isConfirmed;
}

export async function confirmAction(title: string, text: string, confirmButtonText: string, color: string) {
  const Swal = await swal();
  const result = await Swal.fire({
    icon: 'question',
    title,
    text,
    showCancelButton: true,
    confirmButtonText,
    confirmButtonColor: color,
    reverseButtons: true,
  });
  return result.isConfirmed;
}

export async function toastSuccess(title: string) {
  const Swal = await swal();
  void Swal.fire({ icon: 'success', title, toast: true, position: 'top-end', timer: 2500, showConfirmButton: false });
}

export async function toastError(title: string) {
  const Swal = await swal();
  void Swal.fire({ icon: 'error', title, toast: true, position: 'top-end', timer: 4500, showConfirmButton: false });
}

export async function alertError(title: string, text: string) {
  const Swal = await swal();
  await Swal.fire({ icon: 'error', title, text, confirmButtonColor: '#6b7280' });
}
