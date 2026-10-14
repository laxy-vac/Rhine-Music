/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 25 апр. 2020 г.
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

#ifndef PRIVATE_MM_MMIOWRITER_H_
#define PRIVATE_MM_MMIOWRITER_H_

#include <lsp-plug.in/runtime/version.h>

#ifdef PLATFORM_WINDOWS

#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/runtime/LSPString.h>

#include <windows.h>
#include <mmsystem.h>
#include <mmreg.h>

namespace lsp
{
    namespace mm
    {
        /**
         * Audio file writer using MMIO subsystem
         */
        class MMIOWriter
        {
            private:
                MMIOWriter & operator = (const MMIOWriter &);

            protected:
                HMMIO               hMMIO;
                wsize_t             nWritePos;
                wsize_t             nDataSize;
                wssize_t            nFrames;
                bool                bSeekable;
                MMCKINFO            ckRiff;
                MMCKINFO            ckData;
                MMCKINFO            ckFact;

            protected:
                status_t        finalize_riff_file();
                status_t        write_padded(const void *buf, size_t count);

            public:
                explicit MMIOWriter();
                virtual ~MMIOWriter();

            public:
                /**
                 * Check whether reader is seekable
                 * @return true if reader is seekable
                 */
                inline bool seekable() const                { return bSeekable; }

                /**
                 * Set number of frames
                 * @param frames number of frames written
                 */
                inline void set_frames(wssize_t frames)     { nFrames = frames; }

                /**
                 * Open audio file for writing
                 * @param path path to the file
                 * @param fmt output audio format
                 * @param frames number of frames
                 * @return status of operation
                 */
                status_t    open(const LSPString *path, WAVEFORMATEX *fmt, wssize_t frames);

                /**
                 * Seek to the specified location
                 * @param offset offset in bytes from the beginning of data chunk
                 * @return actual offset in bytes from the beginning of data chunk
                 */
                wssize_t    seek(wsize_t offset);

                /**
                 * Write number of bytes into buffer
                 * @param buf pointer to buffer to write
                 * @param count number of bytes to write
                 * @return actual bytes written or negative error code
                 */
                ssize_t     write(const void *buf, size_t count);

                /**
                 * Close the file
                 * @return status of operation
                 */
                status_t    close(status_t code = STATUS_OK);

                /**
                 * Flush pending write operations
                 * @return status of operation
                 */
                status_t    flush();
        };
    
    } /* namespace mm */
} /* namespace lsp */

#endif /* PLATFORM_WINDOWS */

#endif /* PRIVATE_MM_MMIOWRITER_H_ */
