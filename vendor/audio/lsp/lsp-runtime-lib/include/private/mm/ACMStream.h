/*
 * Copyright (C) 2024 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2024 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 24 апр. 2020 г.
 *
 * lsp-runtime-lib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * lsp-runtime-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with lsp-runtime-lib. If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef PRIVATE_MM_ACMSTREAM_H_
#define PRIVATE_MM_ACMSTREAM_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/common/types.h>

#ifdef PLATFORM_WINDOWS

#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/lltl/darray.h>
#include <lsp-plug.in/lltl/parray.h>

#include <windows.h>
#include <mmreg.h>
#include <msacm.h>

namespace lsp
{
    namespace mm
    {
        /**
         * This is Windows-specific only data conversion class
         * responsible for multimedia conversion
         */
        class ACMStream
        {
            private:
                ACMStream & operator = (const ACMStream &);

            public:
                static const size_t     IO_BUF_SIZE     = 0x2000;

            protected:
                // ACM Format descriptor
                typedef struct fmt_t
                {
                    size_t                      id;         // Format index
                    size_t                      fdw;        // Format flags
                    WAVEFORMATEX               *wfex;       // Format descriptor
                } fmt_t;

                // ACM Format tag
                typedef struct fmt_tag_t
                {
                    size_t                      id;         // Tag index
                    size_t                      fdw;        // Format flags
                    LSPString                   name;       // Tag name
                    lltl::darray<fmt_t>         vfmt;       // List of formats
                } fmt_tag_t;

                // ACM driver
                typedef struct drv_t
                {
                    HACMDRIVERID                drv_id;     // ACM Driver identifier
                    size_t                      pwfx_sz;    // Maximum size fo WAVEFORMATEX struct
                    LSPString                   short_name;
                    LSPString                   full_name;
                    LSPString                   copyright;
                    LSPString                   license;
                    LSPString                   features;
                    lltl::parray<fmt_tag_t>     vtag;       // List of tags
                } drv_t;

                typedef struct drv_lookup_t
                {
                    ACMDRIVERDETAILSW       dd;         // Driver details
                    HACMDRIVER              hd;         // Driver handle
                    ACMFORMATTAGDETAILSW    ftd;        // Details for current format tag
                    ACMFORMATDETAILSW       fd;         // Format details
                    WAVEFORMATEX           *req;        // Requested format details
                    DWORD                   req_sz;     // Requested format maximum size

                    lltl::parray<drv_t>     vdrv;       // Complete list of drivers
                    drv_t                  *pdrv;       // Current driver
                    fmt_tag_t              *ptag;       // Current tag
                    fmt_t                  *pfmt;       // Current format
                } drv_lookup_t;

            protected:
                WAVEFORMATEX       *pFmtIn;
                WAVEFORMATEX       *pFmtOut;
                HACMDRIVER          hDriver;
                HACMSTREAM          hStream;
                ACMSTREAMHEADER    *pHeader;
                lltl::parray<drv_t> vDrv;

            protected:
                static WAVEFORMATEX *copy_fmt(const WAVEFORMATEX *src);

            protected:
                static WINBOOL CALLBACK acm_driver_enum_cb(HACMDRIVERID hadid, DWORD_PTR dwInstance, DWORD fdwSupport);

                static void acm_query_format_tags(drv_lookup_t *s);
                static void acm_query_formats(drv_lookup_t *s);
                static status_t acm_enum_drivers(lltl::parray<drv_t> *res);
                static void acm_destroy_drivers(lltl::parray<drv_t> *res);
                static fmt_tag_t *acm_find_tag(drv_t *drv, size_t fmt_tag);
                static fmt_t *acm_select_format(fmt_t *best, fmt_t *curr, WAVEFORMATEX *req);

                status_t acm_configure_stream(WAVEFORMATEX *dst, WAVEFORMATEX *src);
                status_t acm_try_format_dec(WAVEFORMATEX *to, WAVEFORMATEX *from);
                status_t acm_try_format_enc(HACMDRIVER drv, WAVEFORMATEX *to, WAVEFORMATEX *from, size_t szof);
                status_t acm_find_nonstandard_dec(WAVEFORMATEX *fmt);
                status_t acm_find_standard_dec(WAVEFORMATEX *fmt);
                status_t acm_suggest_format_enc(WAVEFORMATEX *fmt);

            public:
                explicit ACMStream();
                ~ACMStream();

            public:
                /**
                 * Get input stream format
                 * @return input stream format
                 */
                inline WAVEFORMATEX *in_format()        { return pFmtIn; }

                /**
                 * Get output stream format
                 * @return output stream format
                 */
                inline WAVEFORMATEX *out_format()       { return pFmtOut; }

                /**
                 * Reserve space for writing data
                 * @param buf pointer to return pointer to the buffer (may be NULL)
                 * @return number of bytes available for write or negative error code
                 */
                ssize_t push(void **buf);

                /**
                 * Commit the push
                 * @param bytes number of bytes read into push buffer returned by push()
                 */
                inline void commit(size_t bytes)    {   pHeader->cbSrcLength   += bytes;    };

                /**
                 * Perform conversion and fetch data into buffer
                 * @param buf pointer to buffer to perform read
                 * @param size maximum number of bytes to pull
                 * @param force retrieve last (final) portion of data
                 * @return number of bytes stored into buffer or negative error code
                 */
                ssize_t pull(void **buf, size_t size, bool force);

                /**
                 * Get number of bytes available for pulling
                 * @return number of bytes available for pulling
                 */
                size_t avail();

                /**
                 * Initialize ACM stream for reading PCM stream described
                 * by the specific format
                 * @param in the input stream format
                 * @return status of operation
                 */
                status_t read_pcm(WAVEFORMATEX *in);

                /**
                 * Initialize ACM stream for writing PCM stream described
                 * by the specific format
                 * @param out the output stream format
                 * @return status of operation
                 */
                status_t write_pcm(WAVEFORMATEX *out);

                /**
                 * Close ACM stream
                 * @param res the result to return
                 * @return status of operation
                 */
                status_t close(status_t res = STATUS_OK);
        };

    } /* namespace mm */
} /* namespace lsp */

#endif /* PLATFORM_WINDOWS */

#endif /* PRIVATE_MM_ACMSTREAM_H_ */
