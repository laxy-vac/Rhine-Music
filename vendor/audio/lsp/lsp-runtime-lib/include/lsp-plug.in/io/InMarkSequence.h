/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 12 февр. 2021 г.
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

#ifndef LSP_PLUG_IN_IO_INMARKSEQUENCE_H_
#define LSP_PLUG_IN_IO_INMARKSEQUENCE_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/io/IInSequence.h>

namespace lsp
{
    namespace io
    {
        /**
         * Buffered sequence, extends the underlying sequence with mark() and reset() methods
         */
        class InMarkSequence: public IInSequence
        {
            protected:
                IInSequence        *pSequence;
                ssize_t             nMarkPos;
                ssize_t             nMarkLen;
                ssize_t             nMarkMax;
                lsp_wchar_t        *pBuf;
                size_t              nBufCap;
                bool                bClose;

            protected:
                status_t            do_close();
                ssize_t             grow_buffer(size_t amount);
                void                clear_mark();

            public:
                explicit InMarkSequence();
                InMarkSequence(const InMarkSequence &) = delete;
                InMarkSequence(InMarkSequence &&) = delete;
                virtual ~InMarkSequence() override;

                InMarkSequence & operator = (const InMarkSequence &) = delete;
                InMarkSequence & operator = (InMarkSequence &&) = delete;

            public:
                status_t                wrap(IInSequence *in, bool close = false);

            public:
                virtual status_t        close() override;
                virtual ssize_t         read(lsp_wchar_t *dst, size_t count) override;
                virtual lsp_swchar_t    read() override;
                virtual ssize_t         skip(size_t count) override;
                virtual status_t        mark(ssize_t limit) override;
                virtual status_t        reset() override;
        };

    } /* namespace io */
} /* namespace lsp */


#endif /* LSP_PLUG_IN_IO_INMARKSEQUENCE_H_ */
