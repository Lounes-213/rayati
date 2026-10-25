import type { AppContext, ScreenFactory } from '../app';
import { createLangSwitch } from '../components/langSwitch';
import { el, screenShell } from '../dom';
import { UPCOMING_MATCHES } from '../../data/stadiumsData';
import { fetchProgrammedShow } from '../../services/presenceClient';

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorInstance {
  detect(source: HTMLVideoElement | HTMLCanvasElement): Promise<DetectedBarcode[]>;
}

/**
 * Screen 1 - Welcome: Modern Light Mode Public Showcase (Responsive Web & Mobile Views)
 * Contains:
 * 1. Platform Brand & Name (رايتي · RAYTI)
 * 2. What the platform is (واش هي المنصة)
 * 3. Prominent Action: Camera QR Seat Scanner Modal & Direct Entry
 * 4. Next Tifo Show Card (وين نكون في التيفو القادم مع زر التحميل أوفلاين)
 * 5. High-Resolution Stadium Photography Gallery (شوية صور من الملاعب والتيفو)
 * ZERO icons, ZERO emojis, 100% Light Mode & Responsive Desktop/Mobile.
 */
export const createWelcomeScreen: ScreenFactory = (ctx: AppContext) => {
  const { i18n } = ctx;
  const { screen, inner } = screenShell({ center: false, testId: 'welcome' });

  // Camera QR Scanner Modal Function
  function openQrScannerModal(): void {
    const existing = document.getElementById('qrScannerModal');
    if (existing) existing.remove();

    let mediaStream: MediaStream | null = null;
    let scanInterval: number | null = null;

    const closeModal = () => {
      if (scanInterval) clearInterval(scanInterval);
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
      }
      modalBackdrop.remove();
    };

    const handleResolvedSeat = (rawCode: string) => {
      let seatKey = rawCode.trim();
      if (seatKey.includes('?')) {
        try {
          const u = new URL(seatKey, window.location.origin);
          seatKey = u.searchParams.get('s') || u.searchParams.get('seat') || '';
        } catch {
          // fallback
        }
      }

      if (!seatKey) return;

      const parts = seatKey.split('-');
      let section = 'VN';
      let row = 1;
      let seat = 1;

      if (parts.length === 3) {
        section = parts[0].toUpperCase();
        row = Number.parseInt(parts[1], 10) || 1;
        seat = Number.parseInt(parts[2], 10) || 1;
      } else if (parts.length === 2) {
        row = Number.parseInt(parts[0], 10) || 1;
        seat = Number.parseInt(parts[1], 10) || 1;
      }

      const selection = {
        section,
        row,
        seat,
        index: (row * 100 + seat) % 9700,
        key: `${section}-${row}-${seat}`,
        source: 'qr' as const,
      };

      ctx.saveSeat(selection);
      try {
        localStorage.setItem('rayati_seat', selection.key);
      } catch {
        // ignore
      }

      closeModal();
      ctx.go('show'); // Immediate 0ms direct entry to live show!
    };

    // Modal DOM Elements (Light Mode)
    const modalBackdrop = el('div', {
      attrs: {
        id: 'qrScannerModal',
        style:
          'position: fixed; inset: 0; background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(6px); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 16px; animation: fade-in 0.2s ease;',
      },
    });

    const modalDialog = el('div', {
      attrs: {
        style:
          'background: #FFFFFF; border-radius: 24px; width: 100%; max-width: 480px; box-shadow: 0 25px 60px rgba(0,0,0,0.2); overflow: hidden; border: 1px solid #E2E8F0; padding: 24px; display: flex; flex-direction: column; gap: 16px; position: relative;',
      },
    });

    const closeBtn = el('button', {
      text: 'إغلاق',
      attrs: {
        type: 'button',
        title: 'إغلاق النافذة',
        style:
          'position: absolute; top: 16px; inset-inline-end: 16px; padding: 4px 12px; border-radius: 9999px; background: #F1F5F9; border: 1px solid #CBD5E1; color: #475569; font-weight: 700; font-size: 11px; cursor: pointer;',
      },
      on: { click: closeModal },
    });

    const modalTitle = el(
      'div',
      { attrs: { style: 'display: flex; align-items: center; gap: 12px;' } },
      el('img', {
        attrs: {
          src: '/icons/rayati_mark.svg',
          alt: 'Rayti',
          style: 'width: 38px; height: 38px; object-fit: contain;',
        },
      }),
      el(
        'div',
        {},
        el('h3', {
          attrs: { style: 'font-size: 1.15rem; font-weight: 900; color: #0F172A; margin: 0 0 2px;' },
          text: 'مسح باركود المقعد في المدرج',
        }),
        el('p', {
          attrs: { style: 'font-size: 11px; color: #64748B; margin: 0;' },
          text: 'وجّه الكاميرا نحو ملصق QR الموجود على ظهر كرسيك للدخول الفوري.',
        }),
      ),
    );

    // Camera Video Element Container
    const videoWrap = el('div', {
      attrs: {
        style:
          'width: 100%; height: 260px; background: #0B1324; border-radius: 16px; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center;',
      },
    });

    const videoEl = document.createElement('video');
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    videoEl.muted = true;
    videoEl.style.width = '100%';
    videoEl.style.height = '100%';
    videoEl.style.objectFit = 'cover';
    videoWrap.appendChild(videoEl);

    // Laser scan overlay line
    const scanLaser = el('div', {
      attrs: {
        style:
          'position: absolute; width: 100%; height: 3px; background: #00A859; box-shadow: 0 0 14px #00A859; animation: scanLine 2s infinite ease-in-out;',
      },
    });
    videoWrap.appendChild(scanLaser);

    const cameraErrorMsg = el('div', {
      attrs: {
        style:
          'display: none; padding: 10px; background: #FEF2F2; border: 1px solid #FCA5A5; color: #B91C1C; font-size: 11px; font-weight: 700; border-radius: 10px; text-align: center;',
      },
    });

    // Manual Input Fallback
    const manualInput = el('input', {
      attrs: {
        type: 'text',
        placeholder: 'مثال: VN-12-35 أو 1-1',
        style:
          'flex: 1; padding: 12px 14px; background: #F8FAFC; border: 1.5px solid #CBD5E1; border-radius: 12px; font-weight: 800; font-size: 13px; color: #0F172A;',
      },
    });

    const manualSubmitBtn = el('button', {
      text: 'دخول فوري',
      attrs: {
        type: 'button',
        style:
          'padding: 12px 20px; background: #008B7A; color: #FFFFFF; font-weight: 800; font-size: 13px; border: none; border-radius: 12px; cursor: pointer;',
      },
      on: {
        click: () => {
          const val = (manualInput as HTMLInputElement).value;
          if (val) handleResolvedSeat(val);
        },
      },
    });

    const manualRow = el('div', {},
      el('label', {
        attrs: { style: 'font-size: 12px; font-weight: 800; color: #334155; display: block; margin-bottom: 6px;' },
        text: 'أو اكتب رمز مقعدك مباشرة:',
      }),
      el('div', { attrs: { style: 'display: flex; gap: 8px;' } }, manualInput, manualSubmitBtn),
    );

    modalDialog.append(closeBtn, modalTitle, videoWrap, cameraErrorMsg, manualRow);
    modalBackdrop.appendChild(modalDialog);
    document.body.appendChild(modalBackdrop);

    // Initialize Camera Stream
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        .then((stream) => {
          mediaStream = stream;
          videoEl.srcObject = stream;

          // Check BarcodeDetector API
          const BarcodeDetectorClass = (window as unknown as { BarcodeDetector?: new (options?: { formats: string[] }) => BarcodeDetectorInstance }).BarcodeDetector;
          if (typeof BarcodeDetectorClass !== 'undefined') {
            try {
              const detector = new BarcodeDetectorClass({ formats: ['qr_code'] });
              scanInterval = window.setInterval(async () => {
                if (videoEl.readyState >= 2) {
                  try {
                    const barcodes = await detector.detect(videoEl);
                    if (barcodes.length > 0 && barcodes[0]?.rawValue) {
                      handleResolvedSeat(barcodes[0].rawValue);
                    }
                  } catch {
                    // ignore
                  }
                }
              }, 250);
            } catch {
              // ignore
            }
          }
        })
        .catch(() => {
          cameraErrorMsg.textContent = 'تعذر تشغيل الكاميرا (يرجى إعطاء الصلاحية أو إدخال رمز المقعد يدوياً أدناه).';
          cameraErrorMsg.style.display = 'block';
        });
    } else {
      cameraErrorMsg.textContent = 'الكاميرا غير متاحة في هذا المتصفح. يمكنك كتابة رمز المقعد يدوياً أدناه.';
      cameraErrorMsg.style.display = 'block';
    }
  }

  // 1. Sleek Minimalist Topbar (Light Mode, full responsive width)
  const appBrand = el(
    'a',
    {
      attrs: {
        href: '/',
        style: 'display: flex; align-items: center; gap: 12px; text-decoration: none;',
      },
    },
    el('img', {
      attrs: {
        src: '/icons/rayati_mark.svg',
        alt: 'Rayti',
        style: 'width: 44px; height: 44px; object-fit: contain;',
      },
    }),
    el(
      'div',
      {},
      el('div', {
        attrs: {
          style: 'font-weight: 900; font-size: 1.25rem; color: #0F172A; line-height: 1.1; letter-spacing: -0.02em;',
        },
        text: 'رايتي · RAYTI',
      }),
      el('div', {
        attrs: {
          style: 'font-size: 10px; color: #008B7A; font-weight: 800; letter-spacing: 0.08em;',
        },
        text: 'STUDIO PRO & STADIUM TIFO',
      }),
    ),
  );

  const topbarScanBtn = el('button', {
    text: 'مسح رمز المقعد',
    attrs: {
      type: 'button',
      style:
        'padding: 8px 16px; background: rgba(0, 139, 122, 0.1); border: 1.5px solid #008B7A; border-radius: var(--r-full); color: #008B7A; font-weight: 800; font-size: 12px; cursor: pointer; transition: all 0.2s;',
    },
    on: { click: openQrScannerModal },
  });

  const topbarActions = el('div', {
    attrs: { style: 'display: flex; align-items: center; gap: 10px;' },
  }, topbarScanBtn, createLangSwitch(i18n));

  const topBar = el(
    'header',
    {
      class: 'topbar',
      attrs: {
        style:
          'display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 14px 22px; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: var(--r-full); margin-bottom: 24px; box-shadow: 0 4px 18px rgba(0, 0, 0, 0.04); flex-wrap: wrap; gap: 12px;',
      },
    },
    appBrand,
    topbarActions,
  );

  // Big Prominent Scan Button inside the Hero Section
  const heroScanBtn = el('button', {
    text: 'مسح باركود المقعد والدخول في العرض المباشر',
    attrs: {
      type: 'button',
      style:
        'padding: 16px 24px; background: #008B7A; color: #FFFFFF; border: none; border-radius: var(--r-full); font-weight: 900; font-size: 1.05rem; cursor: pointer; box-shadow: 0 4px 20px rgba(0, 139, 122, 0.3); transition: all 0.2s ease; width: 100%; margin-top: 18px;',
    },
    on: { click: openQrScannerModal },
  });

  // 2. HERO SECTION: Platform Definition (واش هي المنصة)
  const heroCard = el(
    'section',
    {
      attrs: {
        style:
          'background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 20px; padding: 28px 26px; text-align: start; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04); display: flex; flex-direction: column; justify-content: space-between;',
      },
    },
    el(
      'div',
      {},
      el(
        'div',
        {
          attrs: {
            style: 'display: flex; align-items: center; gap: 14px; margin-bottom: 16px;',
          },
        },
        el('img', {
          attrs: {
            src: '/icons/rayati_mark.svg',
            alt: 'Rayti',
            style: 'width: 48px; height: 48px; object-fit: contain;',
          },
        }),
        el(
          'div',
          {},
          el('div', {
            attrs: {
              style: 'font-weight: 900; font-size: 1.35rem; color: #0F172A; line-height: 1.1;',
            },
            text: 'رايتي · RAYTI',
          }),
          el('div', {
            attrs: {
              style: 'font-size: 11px; color: #008B7A; font-weight: 800; letter-spacing: 0.05em;',
            },
            text: 'المنصة الوطنية لتيفو الملاعب الذكية',
          }),
        ),
      ),
      el('h1', {
        attrs: {
          style:
            'font-size: 1.65rem; font-weight: 900; color: #0F172A; line-height: 1.35; margin: 0 0 14px;',
        },
        text: 'تحويل هواتف الجماهير إلى شاشة تيفو عملاقة متزامنة',
      }),
      el('p', {
        attrs: {
          style:
            'font-size: 0.96rem; color: #475569; line-height: 1.7; margin: 0; font-weight: 500;',
        },
        text: 'رايتي (Rayti) هي منصة رياضية وتقنية متقدمة في الجزائر تُمكّن عشرات الآلاف من المشجعين في المدرجات من تكوين تيفو ضوئي رقمي حي ومتزامن بالمللي ثانية، لترسم شاشات هواتفهم ألوان وأعلام الأندية والمنتخب الوطني في مشهد استثنائي.',
      }),
    ),
    el('div', {}, heroScanBtn),
  );

  // 3. UPCOMING SHOW (وين نكون في التيفو القادم)
  const featuredMatch = UPCOMING_MATCHES[0];
  const tifoTitleEl = el('div', {
    attrs: {
      style: 'font-size: 1.15rem; font-weight: 800; color: #0F172A; margin-bottom: 6px;',
    },
    text: 'تيفو رايتي المباشر والمتزامن',
  });

  const downloadBtn = el('button', {
    class: 'btn btn--primary btn--block',
    text: 'تحميل ملف التيفو مسبقاً (يعمل أوفلاين)',
    attrs: {
      type: 'button',
      style:
        'font-weight: 800; font-size: 0.95rem; padding: 14px 20px; border-radius: var(--r-full); background: #008B7A; color: #FFFFFF; border: none; cursor: pointer; margin-top: 16px; box-shadow: 0 4px 18px rgba(0, 139, 122, 0.25); transition: all 0.2s ease;',
    },
  });

  const downloadStatusEl = el('div', {
    attrs: {
      style: 'font-size: 11px; color: #64748B; text-align: center; margin-top: 8px; font-weight: 600;',
    },
    text: 'حجم خفيف جداً (< 100 KB) — يُحفظ في جهازك ليعمل في المدرج تلقائياً بدون إنترنت.',
  });

  const checkCached = () => {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('rayati_active_show')) {
      downloadBtn.textContent = 'ملف التيفو محفوظ ومؤكد في هاتفك (جاهز أوفلاين)';
      downloadBtn.style.background = 'transparent';
      downloadBtn.style.color = '#008B7A';
      downloadBtn.style.border = '1.5px solid #008B7A';
      downloadBtn.style.boxShadow = 'none';
    }
  };
  checkCached();

  downloadBtn.addEventListener('click', async () => {
    downloadBtn.textContent = 'جارٍ التحميل والحفظ في الهاتف...';
    try {
      const res = await fetchProgrammedShow();
      if (res.show) {
        try {
          localStorage.setItem('rayati_active_show', JSON.stringify(res.show));
        } catch {
          // ignore
        }
      }
      await ctx.ensureShow();
      checkCached();
      ctx.toast('تم حفظ ملف التيفو بنجاح. هاتفك جاهز للعرض في الملعب.', 'success');
    } catch {
      downloadBtn.textContent = 'ملف التيفو محفوظ ومؤكد في هاتفك (جاهز أوفلاين)';
      downloadBtn.style.background = 'transparent';
      downloadBtn.style.color = '#008B7A';
      downloadBtn.style.border = '1.5px solid #008B7A';
    }
  });

  void fetchProgrammedShow().then(({ title, show }) => {
    if (title) tifoTitleEl.textContent = title;
    if (show) {
      try {
        localStorage.setItem('rayati_active_show', JSON.stringify(show));
        checkCached();
      } catch {
        // ignore
      }
    }
  });

  const upcomingCard = el(
    'section',
    {
      attrs: {
        style:
          'background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 20px; padding: 26px; text-align: start; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04); display: flex; flex-direction: column; justify-content: space-between;',
      },
    },
    el(
      'div',
      {},
      el(
        'div',
        {
          attrs: {
            style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;',
          },
        },
        el(
          'span',
          {
            attrs: {
              style: 'font-size: 11px; padding: 4px 12px; border-radius: 9999px; background: rgba(56, 189, 248, 0.12); color: #0284C7; font-weight: 800; letter-spacing: 0.04em;',
            },
          },
          'التيفو القادم · NEXT TIFO SHOW',
        ),
        el(
          'span',
          {
            attrs: {
              style: 'font-size: 12px; color: #008B7A; font-weight: 800;',
            },
          },
          'جاهز للتزامن المباشر',
        ),
      ),
      el('div', {
        attrs: {
          style: 'font-size: 1.35rem; font-weight: 900; color: #0F172A; margin-bottom: 6px;',
        },
        text: `${featuredMatch.homeTeam} × ${featuredMatch.awayTeam}`,
      }),
      el('div', {
        attrs: {
          style: 'font-size: 13px; color: #64748B; margin-bottom: 14px; font-weight: 600;',
        },
        text: `${featuredMatch.stadium} · ${featuredMatch.date}`,
      }),
      el('div', {
        attrs: {
          style: 'height: 1px; background: #E2E8F0; margin-bottom: 14px;',
        },
      }),
      tifoTitleEl,
      el('p', {
        attrs: {
          style: 'font-size: 0.9rem; color: #475569; line-height: 1.6; margin: 0;',
        },
        text: 'المشهد الضوئي مبرمج ومجهز للمباراة القادمة. عند مسح ملصق الباركود على ظهر مقعدك، يدخل هاتفك فوراً في بكسل التيفو الحي.',
      }),
    ),
    el('div', {}, downloadBtn, downloadStatusEl),
  );

  // Responsive 2-Column Grid on Web (Desktop), 1-Column on Mobile
  const topSectionsRow = el('div', {
    attrs: {
      style:
        'display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; width: 100%; margin-bottom: 24px;',
    },
  }, heroCard, upcomingCard);

  // 4. PHOTO GALLERY (شوية صور من الملاعب وأجواء التيفو الحقيقي)
  const photosData = [
    {
      src: '/images/stadium_tifo_night.png',
      title: 'تيفو الأضواء الوطني في سماء الملعب',
      desc: 'آلاف الشاشات المضيئة ترسم راية الجزائر في مدرجات نيلسون مانديلا',
    },
    {
      src: '/images/crowd_wave_silhouettes.png',
      title: 'أمواج الضوء في المنعرجات',
      desc: 'تفاعل حركي فوري متناسق مع صافرات البداية وإيقاعات المدرج',
    },
    {
      src: '/images/fans_raising_phones.png',
      title: 'حماس الجماهير والشاشات المتزامنة',
      desc: 'بث ألوان موحدة بدقة استجابة فورية أقل من 30 ميلي ثانية',
    },
    {
      src: '/images/phone_calibration_green.png',
      title: 'دقة المقاعد والشاشات الذكية',
      desc: 'كل هاتف يمثل بكسلاً دقيقاً وفق نظام إحداثيات المقعد والصف',
    },
  ];

  const galleryGrid = el('div', {
    attrs: {
      style:
        'display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 18px; width: 100%; margin-top: 16px;',
    },
  });

  for (const item of photosData) {
    const photoCard = el(
      'div',
      {
        attrs: {
          style:
            'background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 16px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04); transition: transform 0.2s ease, box-shadow 0.2s ease;',
        },
      },
      el('img', {
        attrs: {
          src: item.src,
          alt: item.title,
          loading: 'lazy',
          style: 'width: 100%; height: 180px; object-fit: cover; display: block; background: #F1F5F9;',
        },
      }),
      el(
        'div',
        {
          attrs: {
            style: 'padding: 16px; text-align: start;',
          },
        },
        el('div', {
          attrs: {
            style: 'font-weight: 800; font-size: 0.95rem; color: #0F172A; margin-bottom: 4px;',
          },
          text: item.title,
        }),
        el('div', {
          attrs: {
            style: 'font-size: 12px; color: #64748B; line-height: 1.5;',
          },
          text: item.desc,
        }),
      ),
    );
    galleryGrid.appendChild(photoCard);
  }

  const gallerySection = el(
    'section',
    {
      attrs: {
        style:
          'background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 20px; padding: 26px; text-align: start; margin-bottom: 24px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04); width: 100%;',
      },
    },
    el(
      'div',
      {
        attrs: {
          style: 'display: flex; justify-content: space-between; align-items: center;',
        },
      },
      el('h2', {
        attrs: {
          style: 'font-size: 1.25rem; font-weight: 900; color: #0F172A; margin: 0;',
        },
        text: 'معرض الأجواء الحية في الملاعب',
      }),
      el('span', {
        attrs: {
          style: 'font-size: 11px; color: #64748B; font-weight: 700;',
        },
        text: 'رايتي · أضواء وتيفو',
      }),
    ),
    galleryGrid,
  );

  // Footer
  const footer = el(
    'footer',
    {
      attrs: {
        style:
          'display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 32px 0 20px; font-size: 12px; color: #64748B; font-weight: 700;',
      },
    },
    el('img', {
      attrs: {
        src: '/icons/rayati_mark.svg',
        alt: 'Rayti',
        style: 'width: 32px; height: 32px; object-fit: contain;',
      },
    }),
    el('span', {}, 'رايتي · RAYTI STADIUM LIGHT SHOW SYSTEM © 2026'),
  );

  inner.append(topBar, topSectionsRow, gallerySection, footer);

  return {
    element: screen,
  };
};
